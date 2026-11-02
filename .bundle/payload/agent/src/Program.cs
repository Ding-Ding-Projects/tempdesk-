using System;
using System.ServiceProcess;
using System.Threading;

namespace TempDesk.Agent
{
    /// <summary>
    /// Entry point. With no arguments the process runs as a Windows service
    /// under the Service Control Manager. With --console it runs in the
    /// foreground for debugging, printing to the console and stopping on
    /// Ctrl+C. An optional --config &lt;path&gt; overrides the configuration
    /// location (default C:\ProgramData\TempDesk\agent.json).
    /// </summary>
    public static class Program
    {
        public static int Main(string[] args)
        {
            bool console = false;
            string configPath = AgentConfig.DefaultConfigPath;

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (string.Equals(a, "--console", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(a, "-c", StringComparison.OrdinalIgnoreCase))
                {
                    console = true;
                }
                else if (string.Equals(a, "--config", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    configPath = args[++i];
                }
            }

            if (console)
            {
                return RunConsole(configPath);
            }

            ServiceBase.Run(new ServiceBase[] { new AgentService(configPath) });
            return 0;
        }

        private static int RunConsole(string configPath)
        {
            AgentHost host = new AgentHost();
            ManualResetEvent stop = new ManualResetEvent(false);

            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e)
            {
                e.Cancel = true;
                Console.WriteLine("Stopping...");
                stop.Set();
            };

            try
            {
                Console.WriteLine("Starting TempDesk Agent (console mode). Config: " + configPath);
                host.Start(configPath);
                Console.WriteLine("Listening. Press Ctrl+C to stop.");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Failed to start: " + ex);
                return 1;
            }

            stop.WaitOne();
            host.Stop();
            Console.WriteLine("Stopped.");
            return 0;
        }
    }
}
