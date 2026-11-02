using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Web.Script.Serialization;

namespace TempDesk.Agent
{
    /// <summary>
    /// JSON helpers. Parsing uses JavaScriptSerializer (objects become
    /// Dictionary&lt;string, object&gt;, arrays become object[]). Serialization is
    /// done by our own writer so that dates are ISO 8601 UTC, enums are strings
    /// and binary data is "b64:" prefixed, none of which JavaScriptSerializer does.
    /// </summary>
    internal static class Json
    {
        private const int MaxWriteDepth = 64;

        public static object Parse(string text)
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = int.MaxValue;
            serializer.RecursionLimit = 64;
            return serializer.DeserializeObject(text);
        }

        /// <summary>Parses a request body that must be a JSON object.</summary>
        public static Dictionary<string, object> ParseObject(string text)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return new Dictionary<string, object>(StringComparer.Ordinal);
            }
            object parsed;
            try
            {
                parsed = Parse(text);
            }
            catch (ArgumentException ex)
            {
                throw AgentException.BadRequest("Request body is not valid JSON: " + ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                throw AgentException.BadRequest("Request body is not valid JSON: " + ex.Message);
            }
            Dictionary<string, object> dict = parsed as Dictionary<string, object>;
            if (dict == null)
            {
                throw AgentException.BadRequest("Request body must be a JSON object.");
            }
            return dict;
        }

        public static string Serialize(object value)
        {
            StringBuilder sb = new StringBuilder();
            Write(sb, value, 0);
            return sb.ToString();
        }

        /// <summary>Formats a date as ISO 8601 UTC with second precision.</summary>
        public static string Iso(DateTime value)
        {
            DateTime utc;
            if (value.Kind == DateTimeKind.Local)
            {
                utc = value.ToUniversalTime();
            }
            else
            {
                // Unspecified is treated as UTC: directory timestamps arrive that way.
                utc = DateTime.SpecifyKind(value, DateTimeKind.Utc);
            }
            return utc.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
        }

        public static object IsoOrNull(DateTime? value)
        {
            if (!value.HasValue)
            {
                return null;
            }
            return Iso(value.Value);
        }

        private static void Write(StringBuilder sb, object value, int depth)
        {
            if (depth > MaxWriteDepth)
            {
                sb.Append("null");
                return;
            }
            if (value == null || value is DBNull)
            {
                sb.Append("null");
                return;
            }
            string s = value as string;
            if (s != null)
            {
                WriteString(sb, s);
                return;
            }
            if (value is bool)
            {
                sb.Append((bool)value ? "true" : "false");
                return;
            }
            if (value is Enum)
            {
                WriteString(sb, value.ToString());
                return;
            }
            if (value is int || value is long || value is short || value is byte || value is sbyte
                || value is uint || value is ulong || value is ushort)
            {
                sb.Append(Convert.ToString(value, CultureInfo.InvariantCulture));
                return;
            }
            if (value is double || value is float)
            {
                double d = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                if (double.IsNaN(d) || double.IsInfinity(d))
                {
                    sb.Append("null");
                }
                else
                {
                    sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
                }
                return;
            }
            if (value is decimal)
            {
                sb.Append(((decimal)value).ToString(CultureInfo.InvariantCulture));
                return;
            }
            if (value is char)
            {
                WriteString(sb, value.ToString());
                return;
            }
            if (value is DateTime)
            {
                WriteString(sb, Iso((DateTime)value));
                return;
            }
            if (value is DateTimeOffset)
            {
                WriteString(sb, Iso(((DateTimeOffset)value).UtcDateTime));
                return;
            }
            if (value is Guid)
            {
                WriteString(sb, ((Guid)value).ToString());
                return;
            }
            if (value is TimeSpan)
            {
                WriteString(sb, ((TimeSpan)value).ToString("c", CultureInfo.InvariantCulture));
                return;
            }
            byte[] bytes = value as byte[];
            if (bytes != null)
            {
                WriteString(sb, "b64:" + Convert.ToBase64String(bytes));
                return;
            }
            IDictionary dict = value as IDictionary;
            if (dict != null)
            {
                sb.Append('{');
                bool first = true;
                foreach (DictionaryEntry entry in dict)
                {
                    if (!first)
                    {
                        sb.Append(',');
                    }
                    first = false;
                    WriteString(sb, Convert.ToString(entry.Key, CultureInfo.InvariantCulture));
                    sb.Append(':');
                    Write(sb, entry.Value, depth + 1);
                }
                sb.Append('}');
                return;
            }
            IEnumerable list = value as IEnumerable;
            if (list != null)
            {
                sb.Append('[');
                bool first = true;
                foreach (object item in list)
                {
                    if (!first)
                    {
                        sb.Append(',');
                    }
                    first = false;
                    Write(sb, item, depth + 1);
                }
                sb.Append(']');
                return;
            }
            WriteString(sb, Convert.ToString(value, CultureInfo.InvariantCulture));
        }

        private static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        // Escape control characters, HTML-sensitive characters and the
                        // JavaScript line separators so the output is safe anywhere.
                        if (c < 0x20 || c == '<' || c == '>' || c == '&' || c == '\u2028' || c == '\u2029')
                        {
                            sb.Append("\\u");
                            sb.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
        }

        // ---------------------------------------------------------------
        // Typed accessors for parsed request bodies. They throw bad_request
        // with a field-specific message when the type is wrong.
        // ---------------------------------------------------------------

        public static bool Has(Dictionary<string, object> d, string key)
        {
            return d != null && d.ContainsKey(key);
        }

        public static string GetString(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null)
            {
                return null;
            }
            string s = v as string;
            if (s == null)
            {
                throw AgentException.BadRequest("Field '" + key + "' must be a string.");
            }
            return s;
        }

        public static string RequireString(Dictionary<string, object> d, string key, int maxLength)
        {
            string s = GetString(d, key);
            if (string.IsNullOrEmpty(s))
            {
                throw AgentException.BadRequest("Field '" + key + "' is required.");
            }
            if (s.Length > maxLength)
            {
                throw AgentException.BadRequest("Field '" + key + "' is too long (max " + maxLength + " characters).");
            }
            return s;
        }

        public static bool? GetNullableBool(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null)
            {
                return null;
            }
            if (!(v is bool))
            {
                throw AgentException.BadRequest("Field '" + key + "' must be true or false.");
            }
            return (bool)v;
        }

        public static bool GetBool(Dictionary<string, object> d, string key, bool defaultValue)
        {
            bool? b = GetNullableBool(d, key);
            return b.HasValue ? b.Value : defaultValue;
        }

        public static long? GetLong(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null)
            {
                return null;
            }
            long result;
            if (!TryToLong(v, out result))
            {
                throw AgentException.BadRequest("Field '" + key + "' must be an integer.");
            }
            return result;
        }

        public static bool TryToLong(object v, out long result)
        {
            result = 0;
            if (v is int) { result = (int)v; return true; }
            if (v is long) { result = (long)v; return true; }
            if (v is decimal)
            {
                decimal m = (decimal)v;
                if (m != decimal.Truncate(m) || m > long.MaxValue || m < long.MinValue) { return false; }
                result = (long)m;
                return true;
            }
            if (v is double)
            {
                double dd = (double)v;
                if (dd != Math.Floor(dd) || dd > long.MaxValue || dd < long.MinValue) { return false; }
                result = (long)dd;
                return true;
            }
            return false;
        }

        public static Dictionary<string, object> GetDict(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null)
            {
                return null;
            }
            Dictionary<string, object> result = v as Dictionary<string, object>;
            if (result == null)
            {
                throw AgentException.BadRequest("Field '" + key + "' must be an object.");
            }
            return result;
        }

        public static List<object> GetList(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null)
            {
                return null;
            }
            List<object> list = AsList(v);
            if (list == null)
            {
                throw AgentException.BadRequest("Field '" + key + "' must be an array.");
            }
            return list;
        }

        /// <summary>Returns the value as a list when it is a JSON array, otherwise null.</summary>
        public static List<object> AsList(object v)
        {
            if (v == null || v is string || v is IDictionary)
            {
                return null;
            }
            IList ilist = v as IList;
            if (ilist == null)
            {
                return null;
            }
            List<object> list = new List<object>(ilist.Count);
            foreach (object item in ilist)
            {
                list.Add(item);
            }
            return list;
        }

        public static List<string> GetStringList(Dictionary<string, object> d, string key)
        {
            List<object> raw = GetList(d, key);
            if (raw == null)
            {
                return null;
            }
            List<string> result = new List<string>(raw.Count);
            foreach (object item in raw)
            {
                string s = item as string;
                if (s == null)
                {
                    throw AgentException.BadRequest("Field '" + key + "' must be an array of strings.");
                }
                result.Add(s);
            }
            return result;
        }
    }
}
