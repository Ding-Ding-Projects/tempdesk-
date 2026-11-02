using System;
using System.Net;
using System.Threading;

namespace TempDesk.Agent
{
    /// <summary>
    /// An HttpListener front end. One listener thread accepts requests and hands
    /// each to the managed thread pool, where the router processes it. The 1 MB
    /// body cap and all error handling live in the router; this class only owns
    /// the listener lifecycle and worker dispatch.
    /// </summary>
    public class HttpServer
    {
        private readonly HttpListener _listener;
        private readonly Router _router;
        private readonly AuditLog _audit;
        private Thread _acceptThread;
        private volatile bool _running;

        public HttpServer(AgentConfig config, Router router, AuditLog audit)
        {
            _router = router;
            _audit = audit;
            _listener = new HttpListener();
            _listener.Prefixes.Add(config.ListenerPrefix());
            // The portal authenticates with API keys and bearer tokens, so the
            // listener itself uses anonymous authentication.
            _listener.AuthenticationSchemes = AuthenticationSchemes.Anonymous;
        }

        public void Start()
        {
            _listener.Start();
            _running = true;
            _acceptThread = new Thread(AcceptLoop);
            _acceptThread.IsBackground = true;
            _acceptThread.Name = "TempDesk-Accept";
            _acceptThread.Start();
        }

        private void AcceptLoop()
        {
            while (_running)
            {
                HttpListenerContext context;
                try
                {
                    context = _listener.GetContext();
                }
                catch (HttpListenerException)
                {
                    // Thrown when the listener is stopped; exit the loop.
                    break;
                }
                catch (ObjectDisposedException)
                {
                    break;
                }
                catch (InvalidOperationException)
                {
                    break;
                }

                // Hand off to a worker so the accept loop keeps draining.
                ThreadPool.QueueUserWorkItem(delegate(object state)
                {
                    HttpListenerContext ctx = (HttpListenerContext)state;
                    try
                    {
                        _router.Dispatch(ctx);
                    }
                    catch (Exception ex)
                    {
                        try { _audit.Error("Worker crashed: " + ex); } catch (Exception) { }
                        try { ctx.Response.Abort(); } catch (Exception) { }
                    }
                }, context);
            }
        }

        public void Stop()
        {
            _running = false;
            try { _listener.Stop(); } catch (Exception) { }
            try { _listener.Close(); } catch (Exception) { }
            if (_acceptThread != null)
            {
                _acceptThread.Join(TimeSpan.FromSeconds(5));
            }
        }
    }
}
