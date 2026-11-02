using System;
using System.Collections.Generic;
using System.Reflection;

namespace TempDesk.Agent
{
    /// <summary>
    /// Builds and owns the running agent: configuration, auth, audit, the
    /// PowerShell host, the router, every discovered module, and the HTTP
    /// server. Both the Windows service and the console mode use this class so
    /// their behavior is identical.
    /// </summary>
    public class AgentHost
    {
        private AgentConfig _config;
        private Auth _auth;
        private AuditLog _audit;
        private PowerShellHost _ps;
        private Router _router;
        private HttpServer _server;

        public void Start(string configPath)
        {
            _config = AgentConfig.Load(configPath);
            _audit = new AuditLog();
            _auth = new Auth(_config, _audit);

            // The PowerShell host may fail to start if the modules are missing;
            // GPO/cmdlet routes then report internal errors, but the directory,
            // guest, wifi, scripts and auth routes still work.
            try
            {
                _ps = new PowerShellHost();
                _ps.LoadCatalog();
            }
            catch (Exception ex)
            {
                _ps = null;
                _audit.Error("PowerShell host failed to start: " + ex.Message);
            }

            _router = new Router(_config, _auth, _audit, _ps);

            // Core is constructed directly because it needs auth/audit/router.
            CoreService core = new CoreService(_config, _auth, _audit, _router);
            RegisterModule(core);

            // Every other module is discovered by reflection so new files (for
            // example the server-management module) light up without editing
            // this class.
            foreach (IAgentModule module in DiscoverModules())
            {
                RegisterModule(module);
            }

            _server = new HttpServer(_config, _router, _audit);
            _server.Start();
            _audit.Admin("service", "start", _config.ListenerPrefix());
        }

        private void RegisterModule(IAgentModule module)
        {
            module.Register(_router);
            _router.AddCapabilities(module.Capabilities);
        }

        /// <summary>
        /// Instantiates every non-abstract IAgentModule with a constructor we
        /// can satisfy from the available services. CoreService is skipped here
        /// because it is wired explicitly.
        /// </summary>
        private List<IAgentModule> DiscoverModules()
        {
            List<IAgentModule> modules = new List<IAgentModule>();
            Assembly assembly = Assembly.GetExecutingAssembly();
            foreach (Type type in assembly.GetTypes())
            {
                if (type.IsAbstract || type.IsInterface)
                {
                    continue;
                }
                if (!typeof(IAgentModule).IsAssignableFrom(type))
                {
                    continue;
                }
                if (type == typeof(CoreService))
                {
                    continue;
                }
                IAgentModule instance = Instantiate(type);
                if (instance != null)
                {
                    modules.Add(instance);
                }
                else
                {
                    _audit.Warn("Could not construct module " + type.FullName + "; no satisfiable constructor.");
                }
            }
            return modules;
        }

        /// <summary>
        /// Constructs a module by matching each constructor parameter to a
        /// service this host owns. Supports the common dependencies modules
        /// need (config, auth, audit, PowerShell host, router) plus a
        /// parameterless constructor.
        /// </summary>
        private IAgentModule Instantiate(Type type)
        {
            foreach (ConstructorInfo ctor in type.GetConstructors())
            {
                ParameterInfo[] parameters = ctor.GetParameters();
                object[] args = new object[parameters.Length];
                bool ok = true;
                for (int i = 0; i < parameters.Length; i++)
                {
                    object service = ResolveService(parameters[i].ParameterType);
                    if (service == null && parameters[i].ParameterType.IsValueType == false)
                    {
                        // A dependency we do not provide: try the next ctor.
                        ok = false;
                        break;
                    }
                    args[i] = service;
                }
                if (ok)
                {
                    try
                    {
                        return (IAgentModule)ctor.Invoke(args);
                    }
                    catch (Exception)
                    {
                        // Try another constructor.
                    }
                }
            }
            return null;
        }

        private object ResolveService(Type type)
        {
            if (type == typeof(AgentConfig)) { return _config; }
            if (type == typeof(Auth)) { return _auth; }
            if (type == typeof(AuditLog)) { return _audit; }
            if (type == typeof(PowerShellHost)) { return _ps; }
            if (type == typeof(Router)) { return _router; }
            return null;
        }

        public void Stop()
        {
            try
            {
                if (_server != null) { _server.Stop(); }
            }
            catch (Exception)
            {
            }
            try
            {
                if (_ps != null) { _ps.Dispose(); }
            }
            catch (Exception)
            {
            }
            if (_audit != null)
            {
                _audit.Admin("service", "stop", "-");
            }
        }
    }
}
