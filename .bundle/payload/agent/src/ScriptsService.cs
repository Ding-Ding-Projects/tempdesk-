using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace TempDesk.Agent
{
    /// <summary>
    /// Startup and logon scripts stored as files under scriptsPath\startup and
    /// scriptsPath\logon. Names are tightly validated so a request can never
    /// escape the folder. PowerShell files are written UTF-8 with a BOM so the
    /// Windows script host reads them in the right encoding.
    /// </summary>
    public class ScriptsService : IAgentModule
    {
        private readonly AgentConfig _config;
        private static readonly Regex NamePattern = new Regex("^[A-Za-z0-9._-]{1,64}$", RegexOptions.Compiled);

        public ScriptsService(AgentConfig config)
        {
            _config = config;
        }

        public string[] Capabilities { get { return new string[] { "scripts" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "scripts", true, false, List);
            router.Map("GET", "scripts/{kind}/{name}", true, false, Get);
            router.Map("PUT", "scripts/{kind}/{name}", true, false, Put);
            router.Map("DELETE", "scripts/{kind}/{name}", true, false, Delete);
        }

        private string KindDir(string kind)
        {
            if (string.IsNullOrEmpty(_config.ScriptsPath))
            {
                throw AgentException.Internal("scriptsPath is not configured.");
            }
            if (!string.Equals(kind, "startup", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(kind, "logon", StringComparison.OrdinalIgnoreCase))
            {
                throw AgentException.BadRequest("kind must be 'startup' or 'logon'.");
            }
            return Path.Combine(_config.ScriptsPath, kind.ToLowerInvariant());
        }

        private static void ValidateName(string name)
        {
            if (!NamePattern.IsMatch(name))
            {
                throw AgentException.BadRequest("Script name must match ^[A-Za-z0-9._-]{1,64}$.");
            }
            string ext = Path.GetExtension(name).ToLowerInvariant();
            if (ext != ".ps1" && ext != ".cmd")
            {
                throw AgentException.BadRequest("Only .ps1 and .cmd scripts are allowed.");
            }
            // A defense-in-depth check even though the pattern forbids separators.
            if (name.IndexOf("..", StringComparison.Ordinal) >= 0
                || name.IndexOf('/') >= 0 || name.IndexOf('\\') >= 0)
            {
                throw AgentException.BadRequest("Invalid script name.");
            }
        }

        private object List(RequestContext ctx)
        {
            string kind = ctx.Query["kind"];
            List<object> result = new List<object>();
            if (string.IsNullOrEmpty(kind))
            {
                AddKind(result, "startup");
                AddKind(result, "logon");
            }
            else
            {
                AddKind(result, kind);
            }
            return result;
        }

        private void AddKind(List<object> result, string kind)
        {
            string dir = KindDir(kind);
            if (!Directory.Exists(dir))
            {
                return;
            }
            foreach (string file in Directory.GetFiles(dir))
            {
                string name = Path.GetFileName(file);
                string ext = Path.GetExtension(name).ToLowerInvariant();
                if (ext != ".ps1" && ext != ".cmd")
                {
                    continue;
                }
                FileInfo info = new FileInfo(file);
                Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                row["name"] = name;
                row["kind"] = kind.ToLowerInvariant();
                row["size"] = info.Length;
                row["modified"] = Json.Iso(info.LastWriteTimeUtc);
                result.Add(row);
            }
        }

        private object Get(RequestContext ctx)
        {
            string kind = ctx.Route("kind");
            string name = ctx.Route("name");
            ValidateName(name);
            string path = Path.Combine(KindDir(kind), name);
            if (!File.Exists(path))
            {
                throw AgentException.NotFound("No such script.");
            }
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["content"] = File.ReadAllText(path, Encoding.UTF8);
            return result;
        }

        private object Put(RequestContext ctx)
        {
            string kind = ctx.Route("kind");
            string name = ctx.Route("name");
            ValidateName(name);
            Dictionary<string, object> body = ctx.BodyJson();
            string content = Json.GetString(body, "content");
            if (content == null) { content = ""; }

            string dir = KindDir(kind);
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, name);

            string ext = Path.GetExtension(name).ToLowerInvariant();
            if (ext == ".ps1")
            {
                // UTF-8 with BOM so Windows PowerShell detects the encoding.
                File.WriteAllText(path, content, new UTF8Encoding(true));
            }
            else
            {
                // .cmd files are read as ANSI/OEM by cmd.exe; keep them BOM-free.
                File.WriteAllText(path, content, new UTF8Encoding(false));
            }
            ctx.Audit("scripts put", kind + "/" + name);
            FileInfo info = new FileInfo(path);
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["name"] = name;
            result["kind"] = kind.ToLowerInvariant();
            result["size"] = info.Length;
            result["modified"] = Json.Iso(info.LastWriteTimeUtc);
            return result;
        }

        private object Delete(RequestContext ctx)
        {
            string kind = ctx.Route("kind");
            string name = ctx.Route("name");
            ValidateName(name);
            string path = Path.Combine(KindDir(kind), name);
            if (File.Exists(path))
            {
                File.Delete(path);
            }
            ctx.Audit("scripts delete", kind + "/" + name);
            return StatusResult.NoContent();
        }
    }
}
