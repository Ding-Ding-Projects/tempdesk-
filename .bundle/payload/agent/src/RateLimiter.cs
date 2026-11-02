using System;
using System.Collections.Generic;

namespace TempDesk.Agent
{
    /// <summary>
    /// A fixed-window per-key rate limiter used for guest creation (keyed by the
    /// X-Forwarded-For value the portal supplies) and for admin login lockout
    /// (keyed by username). All state is in memory and lost on restart, which is
    /// acceptable for both uses.
    /// </summary>
    public class RateLimiter
    {
        private class Window
        {
            public int Count;
            public DateTime Start;
        }

        private readonly object _lock = new object();
        private readonly Dictionary<string, Window> _windows = new Dictionary<string, Window>(StringComparer.OrdinalIgnoreCase);
        private readonly int _max;
        private readonly TimeSpan _period;

        public RateLimiter(int max, TimeSpan period)
        {
            _max = max;
            _period = period;
        }

        /// <summary>
        /// Records one hit for the key. Returns true if the hit is within the
        /// limit, false if the key has exceeded it in the current window.
        /// </summary>
        public bool TryHit(string key)
        {
            if (string.IsNullOrEmpty(key))
            {
                key = "(none)";
            }
            DateTime now = DateTime.UtcNow;
            lock (_lock)
            {
                Window w;
                if (!_windows.TryGetValue(key, out w) || now - w.Start >= _period)
                {
                    w = new Window();
                    w.Start = now;
                    w.Count = 0;
                    _windows[key] = w;
                }
                if (w.Count >= _max)
                {
                    return false;
                }
                w.Count++;
                return true;
            }
        }

        /// <summary>
        /// Records a failure for the key (used for login lockout). Returns the
        /// number of failures in the current window after recording this one.
        /// </summary>
        public int RecordFailure(string key)
        {
            if (string.IsNullOrEmpty(key)) { key = "(none)"; }
            DateTime now = DateTime.UtcNow;
            lock (_lock)
            {
                Window w;
                if (!_windows.TryGetValue(key, out w) || now - w.Start >= _period)
                {
                    w = new Window();
                    w.Start = now;
                    _windows[key] = w;
                }
                w.Count++;
                return w.Count;
            }
        }

        /// <summary>True when the key is currently locked out (at or over the limit).</summary>
        public bool IsBlocked(string key)
        {
            if (string.IsNullOrEmpty(key)) { key = "(none)"; }
            DateTime now = DateTime.UtcNow;
            lock (_lock)
            {
                Window w;
                if (!_windows.TryGetValue(key, out w))
                {
                    return false;
                }
                if (now - w.Start >= _period)
                {
                    _windows.Remove(key);
                    return false;
                }
                return w.Count >= _max;
            }
        }

        public void Reset(string key)
        {
            if (string.IsNullOrEmpty(key)) { key = "(none)"; }
            lock (_lock)
            {
                _windows.Remove(key);
            }
        }
    }
}
