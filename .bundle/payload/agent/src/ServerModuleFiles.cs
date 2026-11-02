using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;

namespace TempDesk.Agent
{
    /// <summary>
    /// File system browsing and operations: list, download, upload (multipart,
    /// 500 MB cap, streamed to disk), mkdir, rename, copy, move, delete, ACL and
    /// hash. Every path is validated as an absolute local or UNC path.
    /// </summary>
    public class ServerFilesModule : IAgentModule
    {
        private const long UploadCap = 500L * 1024 * 1024; // 500 MB

        public string[] Capabilities
        {
            get { return new string[] { "files" }; }
        }

        public void Register(Router router)
        {
            router.Map("GET", "server/files", true, false, List);
            router.Map("GET", "server/files/download", true, false, Download);
            router.Map("POST", "server/files/upload", true, false, Upload);
            router.Map("POST", "server/files/mkdir", true, false, Mkdir);
            router.Map("POST", "server/files/rename", true, false, Rename);
            router.Map("POST", "server/files/copy", true, false, Copy);
            router.Map("POST", "server/files/move", true, false, Move);
            router.Map("DELETE", "server/files", true, false, Delete);
            router.Map("GET", "server/files/acl", true, false, GetAcl);
            router.Map("PUT", "server/files/acl", true, false, SetAcl);
            router.Map("GET", "server/files/hash", true, false, Hash);
        }

        // ------------------------------------------------------------- list

        private object List(RequestContext ctx)
        {
            string path = ctx.Query["path"];
            if (string.IsNullOrEmpty(path))
            {
                // No path: list the fixed logical drives as "folders".
                return ListDrives();
            }
            Srv.RequireAbsolutePath(path);
            if (!Directory.Exists(path))
            {
                throw AgentException.NotFound("That folder does not exist.");
            }
            Dictionary<string, object> result = Srv.P();
            result["path"] = path;
            List<object> entries = new List<object>();
            try
            {
                foreach (string dir in Directory.GetDirectories(path))
                {
                    entries.Add(Entry(dir, true));
                }
                foreach (string file in Directory.GetFiles(path))
                {
                    entries.Add(Entry(file, false));
                }
            }
            catch (UnauthorizedAccessException)
            {
                throw AgentException.Forbidden("Access to that folder was denied.");
            }
            result["entries"] = entries;
            return result;
        }

        private object ListDrives()
        {
            Dictionary<string, object> result = Srv.P();
            result["path"] = null;
            List<object> entries = new List<object>();
            foreach (DriveInfo di in DriveInfo.GetDrives())
            {
                Dictionary<string, object> d = Srv.P();
                d["name"] = di.Name;
                d["path"] = di.Name;
                d["isDirectory"] = true;
                d["driveType"] = di.DriveType.ToString();
                try
                {
                    if (di.IsReady)
                    {
                        d["sizeBytes"] = di.TotalSize;
                        d["freeBytes"] = di.TotalFreeSpace;
                    }
                }
                catch (Exception) { }
                entries.Add(d);
            }
            result["entries"] = entries;
            return result;
        }

        private Dictionary<string, object> Entry(string full, bool isDir)
        {
            Dictionary<string, object> d = Srv.P();
            d["name"] = Path.GetFileName(full.TrimEnd('\\', '/'));
            d["path"] = full;
            d["isDirectory"] = isDir;
            try
            {
                if (isDir)
                {
                    DirectoryInfo info = new DirectoryInfo(full);
                    d["modified"] = Json.Iso(info.LastWriteTimeUtc);
                    d["attributes"] = info.Attributes.ToString();
                }
                else
                {
                    FileInfo info = new FileInfo(full);
                    d["sizeBytes"] = info.Length;
                    d["modified"] = Json.Iso(info.LastWriteTimeUtc);
                    d["attributes"] = info.Attributes.ToString();
                }
            }
            catch (Exception) { }
            return d;
        }

        // ------------------------------------------------------------- download

        private object Download(RequestContext ctx)
        {
            string path = ctx.Query["path"];
            Srv.RequireAbsolutePath(path);
            if (!File.Exists(path))
            {
                throw AgentException.NotFound("That file does not exist.");
            }
            ctx.Audit("file download", path);
            return Srv.FileDownload(path, "application/octet-stream", Path.GetFileName(path));
        }

        // ------------------------------------------------------------- upload

        private object Upload(RequestContext ctx)
        {
            string dir = ctx.Query["path"];
            Srv.RequireAbsolutePath(dir);
            if (!Directory.Exists(dir))
            {
                throw AgentException.NotFound("The destination folder does not exist.");
            }
            HttpListenerRequest req = ctx.Request;
            string contentType = req.ContentType;
            if (string.IsNullOrEmpty(contentType) || contentType.IndexOf("multipart/form-data", StringComparison.OrdinalIgnoreCase) < 0)
            {
                throw AgentException.BadRequest("Upload must be multipart/form-data.");
            }
            string boundary = ExtractBoundary(contentType);
            if (string.IsNullOrEmpty(boundary))
            {
                throw AgentException.BadRequest("The multipart boundary is missing.");
            }

            MultipartFile saved = ReadFirstFilePart(req.InputStream, boundary, req.ContentEncoding, dir);
            if (saved == null)
            {
                throw AgentException.BadRequest("No file part was found in the upload.");
            }
            ctx.Audit("file upload", saved.SavedPath);
            Dictionary<string, object> result = Srv.P();
            result["name"] = saved.FileName;
            result["path"] = saved.SavedPath;
            result["sizeBytes"] = saved.Size;
            return StatusResult.Created(result);
        }

        private class MultipartFile
        {
            public string FileName;
            public string SavedPath;
            public long Size;
        }

        private static string ExtractBoundary(string contentType)
        {
            foreach (string part in contentType.Split(';'))
            {
                string p = part.Trim();
                if (p.StartsWith("boundary=", StringComparison.OrdinalIgnoreCase))
                {
                    string b = p.Substring("boundary=".Length).Trim();
                    if (b.Length >= 2 && b[0] == '"' && b[b.Length - 1] == '"')
                    {
                        b = b.Substring(1, b.Length - 2);
                    }
                    return b;
                }
            }
            return null;
        }

        /// <summary>
        /// Streams the request body, finds the first part that carries a
        /// filename, and writes its content to disk while enforcing the 500 MB
        /// cap. A deliberately small, dependency-free multipart reader that works
        /// on the raw byte stream so a huge upload never lands in memory.
        /// </summary>
        private MultipartFile ReadFirstFilePart(Stream body, string boundary, Encoding encoding, string destDir)
        {
            byte[] dashBoundary = Encoding.ASCII.GetBytes("--" + boundary);
            byte[] crlf = new byte[] { 13, 10 };
            BoundaryStream reader = new BoundaryStream(body, dashBoundary);

            // Advance to the first boundary.
            if (!reader.SkipToFirstBoundary())
            {
                return null;
            }
            while (!reader.IsFinished)
            {
                // Each part begins with headers terminated by a blank line.
                string headerBlock = reader.ReadHeaders();
                if (headerBlock == null) { break; }
                string disposition = HeaderValue(headerBlock, "Content-Disposition");
                string fileName = DispositionParam(disposition, "filename");
                if (string.IsNullOrEmpty(fileName))
                {
                    // Not a file part: discard its body and move on.
                    reader.DiscardPartBody();
                    continue;
                }
                fileName = Srv.LeafName(fileName);
                if (string.IsNullOrEmpty(fileName) || !Srv.SimpleName.IsMatch(fileName))
                {
                    throw AgentException.BadRequest("The uploaded file name is not allowed.");
                }
                string target = Path.Combine(destDir, fileName);
                long written = 0;
                try
                {
                    using (FileStream fs = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None, 65536))
                    {
                        written = reader.CopyPartBodyTo(fs, UploadCap);
                    }
                }
                catch (CapExceededException)
                {
                    try { File.Delete(target); } catch (Exception) { }
                    throw new AgentException(413, "bad_request", "The upload exceeds the 500 MB limit.");
                }
                catch (UnauthorizedAccessException)
                {
                    throw AgentException.Forbidden("Access to the destination was denied.");
                }
                MultipartFile mf = new MultipartFile();
                mf.FileName = fileName;
                mf.SavedPath = target;
                mf.Size = written;
                return mf;
            }
            return null;
        }

        private static string HeaderValue(string headerBlock, string name)
        {
            foreach (string line in headerBlock.Split('\n'))
            {
                string l = line.Trim();
                int colon = l.IndexOf(':');
                if (colon > 0 && string.Equals(l.Substring(0, colon).Trim(), name, StringComparison.OrdinalIgnoreCase))
                {
                    return l.Substring(colon + 1).Trim();
                }
            }
            return null;
        }

        private static string DispositionParam(string disposition, string name)
        {
            if (string.IsNullOrEmpty(disposition)) { return null; }
            foreach (string part in disposition.Split(';'))
            {
                string p = part.Trim();
                if (p.StartsWith(name + "=", StringComparison.OrdinalIgnoreCase))
                {
                    string v = p.Substring(name.Length + 1).Trim();
                    if (v.Length >= 2 && v[0] == '"' && v[v.Length - 1] == '"')
                    {
                        v = v.Substring(1, v.Length - 2);
                    }
                    return v;
                }
            }
            return null;
        }

        // ------------------------------------------------------------- mkdir/rename/copy/move

        private object Mkdir(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string path = Json.RequireString(body, "path", 4096);
            Srv.RequireAbsolutePath(path);
            ctx.Audit("file mkdir", path);
            try
            {
                Directory.CreateDirectory(path);
            }
            catch (UnauthorizedAccessException)
            {
                throw AgentException.Forbidden("Access was denied.");
            }
            Dictionary<string, object> result = Srv.P();
            result["path"] = path;
            return StatusResult.Created(result);
        }

        private object Rename(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string path = Json.RequireString(body, "path", 4096);
            string newName = Json.RequireString(body, "newName", 256);
            Srv.RequireAbsolutePath(path);
            newName = Srv.LeafName(newName);
            if (!Srv.SimpleName.IsMatch(newName))
            {
                throw AgentException.BadRequest("The new name is not allowed.");
            }
            string parent = Path.GetDirectoryName(path.TrimEnd('\\', '/'));
            string target = Path.Combine(parent, newName);
            ctx.Audit("file rename", path + " -> " + newName);
            MoveItem(path, target, false);
            Dictionary<string, object> result = Srv.P();
            result["path"] = target;
            return result;
        }

        private object Copy(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string source = Json.RequireString(body, "source", 4096);
            string destination = Json.RequireString(body, "destination", 4096);
            Srv.RequireAbsolutePath(source);
            Srv.RequireAbsolutePath(destination);
            ctx.Audit("file copy", source + " -> " + destination);
            Srv.Ps(ctx, "Copy-Item", NewP("Path", source, "Destination", destination, "Recurse", true, "Force", true));
            Dictionary<string, object> result = Srv.P();
            result["path"] = destination;
            return result;
        }

        private object Move(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string source = Json.RequireString(body, "source", 4096);
            string destination = Json.RequireString(body, "destination", 4096);
            Srv.RequireAbsolutePath(source);
            Srv.RequireAbsolutePath(destination);
            ctx.Audit("file move", source + " -> " + destination);
            MoveItem(source, destination, false);
            Dictionary<string, object> result = Srv.P();
            result["path"] = destination;
            return result;
        }

        private void MoveItem(string source, string target, bool overwrite)
        {
            try
            {
                if (Directory.Exists(source))
                {
                    Directory.Move(source, target);
                }
                else if (File.Exists(source))
                {
                    if (overwrite && File.Exists(target)) { File.Delete(target); }
                    File.Move(source, target);
                }
                else
                {
                    throw AgentException.NotFound("The source does not exist.");
                }
            }
            catch (IOException ex)
            {
                throw AgentException.Conflict(ex.Message);
            }
            catch (UnauthorizedAccessException)
            {
                throw AgentException.Forbidden("Access was denied.");
            }
        }

        private object Delete(RequestContext ctx)
        {
            string path = ctx.Query["path"];
            Srv.RequireAbsolutePath(path);
            string leaf = Srv.LeafName(path);
            Srv.RequireConfirmQuery(ctx, leaf);
            ctx.Audit("file delete", path);
            try
            {
                if (Directory.Exists(path))
                {
                    Directory.Delete(path, true);
                }
                else if (File.Exists(path))
                {
                    File.Delete(path);
                }
                else
                {
                    throw AgentException.NotFound("That item does not exist.");
                }
            }
            catch (UnauthorizedAccessException)
            {
                throw AgentException.Forbidden("Access was denied.");
            }
            catch (IOException ex)
            {
                throw AgentException.Conflict(ex.Message);
            }
            return StatusResult.NoContent();
        }

        // ------------------------------------------------------------- acl

        private object GetAcl(RequestContext ctx)
        {
            string path = ctx.Query["path"];
            Srv.RequireAbsolutePath(path);
            Dictionary<string, object> acl = Srv.PsOne(ctx, "Get-Acl", NewP("Path", path));
            Dictionary<string, object> result = Srv.P();
            result["path"] = path;
            result["owner"] = Srv.Str(acl, "Owner");
            result["sddl"] = Srv.Str(acl, "Sddl");
            result["accessToString"] = Srv.Str(acl, "AccessToString");
            return result;
        }

        private object SetAcl(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string path = Json.RequireString(body, "path", 4096);
            Srv.RequireAbsolutePath(path);
            string sddl = Json.GetString(body, "sddl");
            if (string.IsNullOrEmpty(sddl))
            {
                throw AgentException.BadRequest("An SDDL string is required to set the ACL.");
            }
            // Build a security descriptor from the SDDL in-process (data, never
            // script text), then apply it with icacls, which accepts an SDDL
            // directly and needs no multi-step PowerShell pipeline.
            try
            {
                System.Security.AccessControl.RawSecurityDescriptor rsd =
                    new System.Security.AccessControl.RawSecurityDescriptor(sddl);
                rsd.ToString(); // validates it parsed
            }
            catch (Exception)
            {
                throw AgentException.BadRequest("The SDDL string could not be parsed.");
            }
            ctx.Audit("file acl set", path);
            // icacls <path> /setowner is not SDDL; use the /restore form via a
            // temp SDDL file so the whole descriptor (owner, group, DACL, SACL)
            // is applied atomically.
            string sddlFile = Srv.NewTempFile(".sddl");
            try
            {
                File.WriteAllText(sddlFile, Srv.LeafName(path) + " " + sddl + "\r\n", new UTF8Encoding(false));
                string parent = Path.GetDirectoryName(path.TrimEnd('\\', '/'));
                ProcessResult r = Srv.RunProcess("icacls.exe",
                    new string[] { parent, "/restore", sddlFile }, 30000);
                if (r.ExitCode != 0)
                {
                    throw AgentException.Internal("icacls could not apply the ACL: " + r.StdErr + r.StdOut);
                }
            }
            finally
            {
                try { File.Delete(sddlFile); } catch (Exception) { }
            }
            Dictionary<string, object> result = Srv.P();
            result["path"] = path;
            return result;
        }

        private object Hash(RequestContext ctx)
        {
            string path = ctx.Query["path"];
            Srv.RequireAbsolutePath(path);
            string algo = ctx.Query["algorithm"];
            if (string.IsNullOrEmpty(algo)) { algo = "SHA256"; }
            if (algo != "SHA1" && algo != "SHA256" && algo != "SHA384" && algo != "SHA512" && algo != "MD5")
            {
                throw AgentException.BadRequest("algorithm must be one of MD5, SHA1, SHA256, SHA384, SHA512.");
            }
            if (!File.Exists(path))
            {
                throw AgentException.NotFound("That file does not exist.");
            }
            Dictionary<string, object> row = Srv.PsOne(ctx, "Get-FileHash", NewP("Path", path, "Algorithm", algo));
            Dictionary<string, object> result = Srv.P();
            result["path"] = path;
            result["algorithm"] = algo;
            result["hash"] = Srv.Str(row, "Hash");
            return result;
        }

        private static IDictionary<string, object> NewP(params object[] kv)
        {
            Dictionary<string, object> d = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int i = 0; i + 1 < kv.Length; i += 2)
            {
                d[Convert.ToString(kv[i], CultureInfo.InvariantCulture)] = kv[i + 1];
            }
            return d;
        }
    }

    internal class CapExceededException : Exception { }

    /// <summary>
    /// A minimal forward-only multipart body reader. It scans the raw stream for
    /// the boundary marker, exposes each part's headers, and streams each part's
    /// body to a destination while enforcing a byte cap. Buffers only a small
    /// window, so a multi-hundred-megabyte upload never sits in memory.
    /// </summary>
    internal class BoundaryStream
    {
        private readonly Stream _source;
        private readonly byte[] _boundary;
        private readonly byte[] _buffer;
        private int _start;
        private int _end;
        private bool _eof;
        private bool _finished;

        public BoundaryStream(Stream source, byte[] boundary)
        {
            _source = source;
            _boundary = boundary;
            _buffer = new byte[128 * 1024];
            _start = 0;
            _end = 0;
        }

        public bool IsFinished { get { return _finished; } }

        private bool Fill()
        {
            if (_eof) { return _end > _start; }
            if (_start > 0)
            {
                Array.Copy(_buffer, _start, _buffer, 0, _end - _start);
                _end -= _start;
                _start = 0;
            }
            if (_end >= _buffer.Length) { return true; }
            int read = _source.Read(_buffer, _end, _buffer.Length - _end);
            if (read <= 0) { _eof = true; return _end > _start; }
            _end += read;
            return true;
        }

        public bool SkipToFirstBoundary()
        {
            int idx = FindBoundary();
            while (idx < 0)
            {
                // Keep the tail that might hold a partial boundary.
                if (_end - _start > _boundary.Length)
                {
                    _start = _end - _boundary.Length;
                }
                if (!Fill() && _eof) { return false; }
                idx = FindBoundary();
                if (_eof && idx < 0) { return false; }
            }
            _start = idx + _boundary.Length;
            ConsumeBoundaryTail();
            return !_finished;
        }

        /// <summary>Reads header lines up to the blank line; returns null at the end.</summary>
        public string ReadHeaders()
        {
            StringBuilder sb = new StringBuilder();
            int consecutiveNewlines = 0;
            while (true)
            {
                if (_start >= _end && !Fill()) { return sb.Length > 0 ? sb.ToString() : null; }
                if (_start >= _end) { return sb.Length > 0 ? sb.ToString() : null; }
                byte b = _buffer[_start++];
                if (b == 13) { continue; }
                if (b == 10)
                {
                    consecutiveNewlines++;
                    if (consecutiveNewlines >= 1 && EndsWithBlankLine(sb))
                    {
                        return sb.ToString();
                    }
                    sb.Append('\n');
                    // A blank line (immediate \n) ends the headers.
                    if (sb.Length >= 1 && IsBlankTerminator(sb))
                    {
                        return sb.ToString();
                    }
                }
                else
                {
                    consecutiveNewlines = 0;
                    sb.Append((char)b);
                }
            }
        }

        private static bool EndsWithBlankLine(StringBuilder sb)
        {
            int n = sb.Length;
            return n >= 1 && sb[n - 1] == '\n';
        }

        private static bool IsBlankTerminator(StringBuilder sb)
        {
            // Headers end at an empty line: two newlines in a row.
            int n = sb.Length;
            if (n >= 2 && sb[n - 1] == '\n' && sb[n - 2] == '\n') { return true; }
            return false;
        }

        /// <summary>Copies the current part body (up to the next boundary) to dest.</summary>
        public long CopyPartBodyTo(Stream dest, long cap)
        {
            long total = 0;
            while (true)
            {
                if (!Fill() && _start >= _end) { break; }
                int idx = FindBoundary();
                if (idx >= 0)
                {
                    // Write everything before the boundary (minus the trailing CRLF).
                    int bodyEnd = idx;
                    if (bodyEnd >= 2 && _buffer[bodyEnd - 1] == 10 && _buffer[bodyEnd - 2] == 13)
                    {
                        bodyEnd -= 2;
                    }
                    int len = bodyEnd - _start;
                    if (len > 0)
                    {
                        total += len;
                        if (total > cap) { throw new CapExceededException(); }
                        dest.Write(_buffer, _start, len);
                    }
                    _start = idx + _boundary.Length;
                    ConsumeBoundaryTail();
                    return total;
                }
                // No boundary yet: flush all but a boundary-sized tail.
                int safe = _end - _start - _boundary.Length;
                if (safe > 0)
                {
                    total += safe;
                    if (total > cap) { throw new CapExceededException(); }
                    dest.Write(_buffer, _start, safe);
                    _start += safe;
                }
                else if (_eof)
                {
                    int rest = _end - _start;
                    if (rest > 0)
                    {
                        total += rest;
                        if (total > cap) { throw new CapExceededException(); }
                        dest.Write(_buffer, _start, rest);
                        _start = _end;
                    }
                    break;
                }
            }
            return total;
        }

        public void DiscardPartBody()
        {
            // Copy to a null sink.
            using (Stream sink = Stream.Null)
            {
                CopyPartBodyTo(sink, long.MaxValue);
            }
        }

        private int FindBoundary()
        {
            // Search for _boundary within [_start, _end).
            int limit = _end - _boundary.Length;
            for (int i = _start; i <= limit; i++)
            {
                bool match = true;
                for (int j = 0; j < _boundary.Length; j++)
                {
                    if (_buffer[i + j] != _boundary[j]) { match = false; break; }
                }
                if (match) { return i; }
            }
            return -1;
        }

        private void ConsumeBoundaryTail()
        {
            // After a boundary comes either "--" (final) then CRLF, or CRLF.
            EnsureAvailable(2);
            if (_start + 1 < _end && _buffer[_start] == 45 && _buffer[_start + 1] == 45)
            {
                _finished = true;
                _start += 2;
            }
            // Skip a trailing CRLF.
            EnsureAvailable(2);
            if (_start < _end && _buffer[_start] == 13) { _start++; }
            if (_start < _end && _buffer[_start] == 10) { _start++; }
        }

        private void EnsureAvailable(int n)
        {
            if (_end - _start < n && !_eof)
            {
                Fill();
            }
        }
    }
}
