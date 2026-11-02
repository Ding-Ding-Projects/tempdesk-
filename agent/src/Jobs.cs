using System;
using System.Collections.Generic;
using System.Threading;

namespace TempDesk.Agent
{
    /// <summary>
    /// A single long-running operation (feature install, update install, and so
    /// on). State is one of Running, Completed or Failed. Progress is 0..100.
    /// Output and Errors are plain-text lines gathered as the work runs.
    /// </summary>
    public class Job
    {
        private readonly object _lock = new object();
        private readonly string _id;
        private readonly string _kind;
        private readonly DateTime _created;
        private string _state;
        private int _progress;
        private readonly List<string> _output = new List<string>();
        private readonly List<string> _errors = new List<string>();
        private DateTime? _finished;

        public Job(string id, string kind)
        {
            _id = id;
            _kind = kind;
            _created = DateTime.UtcNow;
            _state = "Running";
            _progress = 0;
        }

        public string Id { get { return _id; } }

        public void SetProgress(int percent)
        {
            lock (_lock)
            {
                if (percent < 0) { percent = 0; }
                if (percent > 100) { percent = 100; }
                _progress = percent;
            }
        }

        public void AddOutput(string line)
        {
            if (line == null) { return; }
            lock (_lock)
            {
                if (_output.Count < 2000) { _output.Add(line); }
            }
        }

        public void AddError(string line)
        {
            if (line == null) { return; }
            lock (_lock)
            {
                if (_errors.Count < 2000) { _errors.Add(line); }
            }
        }

        public void Complete()
        {
            lock (_lock)
            {
                _state = "Completed";
                _progress = 100;
                _finished = DateTime.UtcNow;
            }
        }

        public void Fail(string message)
        {
            lock (_lock)
            {
                if (!string.IsNullOrEmpty(message)) { _errors.Add(message); }
                _state = "Failed";
                _finished = DateTime.UtcNow;
            }
        }

        /// <summary>Snapshot shaped for the GET /jobs/{id} response.</summary>
        public Dictionary<string, object> Snapshot()
        {
            lock (_lock)
            {
                Dictionary<string, object> d = new Dictionary<string, object>(StringComparer.Ordinal);
                d["jobId"] = _id;
                d["kind"] = _kind;
                d["state"] = _state;
                d["progress"] = _progress;
                d["output"] = new List<string>(_output);
                d["errors"] = new List<string>(_errors);
                d["created"] = Json.Iso(_created);
                d["finished"] = _finished.HasValue ? (object)Json.Iso(_finished.Value) : null;
                return d;
            }
        }
    }

    /// <summary>
    /// Process-wide in-memory registry of jobs. Jobs survive only for the life of
    /// the agent process; finished jobs are kept so the portal can poll the final
    /// state, and the oldest are trimmed once the registry grows large.
    /// </summary>
    public static class JobRegistry
    {
        private static readonly object _lock = new object();
        private static readonly Dictionary<string, Job> _jobs =
            new Dictionary<string, Job>(StringComparer.Ordinal);
        private static readonly List<string> _order = new List<string>();
        private const int MaxJobs = 500;

        /// <summary>
        /// Creates a job and runs <paramref name="work"/> on a background thread.
        /// The work delegate receives the job so it can report progress and output.
        /// Any exception thrown by the work marks the job Failed.
        /// </summary>
        public static Job Start(string kind, Action<Job> work)
        {
            string id = Guid.NewGuid().ToString("N");
            Job job = new Job(id, kind);
            lock (_lock)
            {
                _jobs[id] = job;
                _order.Add(id);
                Trim();
            }
            Thread t = new Thread(delegate()
            {
                try
                {
                    work(job);
                    job.Complete();
                }
                catch (AgentException ax)
                {
                    job.Fail(ax.Message);
                }
                catch (Exception ex)
                {
                    job.Fail(ex.Message);
                }
            });
            t.IsBackground = true;
            t.Start();
            return job;
        }

        public static Job Get(string id)
        {
            lock (_lock)
            {
                Job job;
                return _jobs.TryGetValue(id, out job) ? job : null;
            }
        }

        private static void Trim()
        {
            while (_order.Count > MaxJobs)
            {
                string oldest = _order[0];
                _order.RemoveAt(0);
                _jobs.Remove(oldest);
            }
        }
    }

    /// <summary>
    /// Registers GET /jobs/{id}. Separate tiny module so the job route exists
    /// even if only some server capabilities are compiled in.
    /// </summary>
    public class JobsModule : IAgentModule
    {
        public string[] Capabilities
        {
            get { return new string[0]; }
        }

        public void Register(Router router)
        {
            router.Map("GET", "jobs/{id}", true, false, GetJob);
        }

        private object GetJob(RequestContext ctx)
        {
            string id = ctx.Route("id");
            Job job = JobRegistry.Get(id);
            if (job == null)
            {
                throw AgentException.NotFound("No such job.");
            }
            return job.Snapshot();
        }
    }
}
