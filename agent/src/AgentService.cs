using System;
using System.ServiceProcess;

namespace TempDesk.Agent
{
    /// <summary>
    /// The Windows service wrapper. The service name is "TempDeskAgent". It
    /// starts the agent host on OnStart and stops it gracefully on OnStop.
    /// Startup failures are logged and rethrown so the Service Control Manager
    /// reports the service as failed rather than silently running dead.
    /// </summary>
    public class AgentService : ServiceBase
    {
        public const string Name = "TempDeskAgent";

        private readonly AgentHost _host = new AgentHost();
        private readonly string _configPath;

        public AgentService(string configPath)
        {
            ServiceName = Name;
            CanStop = true;
            CanShutdown = true;
            CanPauseAndContinue = false;
            AutoLog = true;
            _configPath = configPath;
        }

        protected override void OnStart(string[] args)
        {
            try
            {
                _host.Start(_configPath);
            }
            catch (Exception ex)
            {
                // Surface the failure to the SCM and the event log.
                try
                {
                    EventLog.WriteEntry("Failed to start TempDesk Agent: " + ex,
                        System.Diagnostics.EventLogEntryType.Error);
                }
                catch (Exception)
                {
                }
                throw;
            }
        }

        protected override void OnStop()
        {
            _host.Stop();
        }

        protected override void OnShutdown()
        {
            _host.Stop();
        }
    }
}
