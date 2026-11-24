using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Skimd
{
    internal static class Program
    {
        private const string PipeName = "Skimd_SingleInstance_v1";
        private const string MutexName = "Local\\Skimd_SingleInstance_Mutex_v1";

        [STAThread]
        private static int Main(string[] args)
        {
            string exePath = Application.ExecutablePath;
            string exeDir = Path.GetDirectoryName(exePath) ?? AppDomain.CurrentDomain.BaseDirectory;

            if (HandleCliFlags(args, exePath, exeDir))
            {
                return 0;
            }

            string[] startupFiles = ResolveFileArguments(args);

            bool createdNew;
            using (Mutex mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    SendFilesToRunningInstance(startupFiles);
                    return 0;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                MainForm form = new MainForm(exePath, startupFiles);
                Thread pipeThread = new Thread(delegate() { RunPipeServer(form); });
                pipeThread.IsBackground = true;
                pipeThread.Start();

                Application.Run(form);
                return 0;
            }
        }

        private static bool HandleCliFlags(string[] args, string exePath, string exeDir)
        {
            if (args == null || args.Length == 0) return false;

            bool hasVersion = false;
            bool hasStatus = false;
            bool regPath = false;
            bool regMd = false;
            bool regAll = false;
            bool unreg = false;

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i].Trim().ToLowerInvariant();
                if (a == "--version" || a == "-v") hasVersion = true;
                else if (a == "--status") hasStatus = true;
                else if (a == "--register-path") regPath = true;
                else if (a == "--register-md") regMd = true;
                else if (a == "--register-all") regAll = true;
                else if (a == "--unregister") unreg = true;
            }

            if (!hasVersion && !hasStatus && !regPath && !regMd && !regAll && !unreg)
            {
                return false;
            }

            NativeMethods.AttachConsole(NativeMethods.ATTACH_PARENT_PROCESS);

            if (hasVersion)
            {
                Console.WriteLine("Skimd 1.0.0-beta.2");
                return true;
            }

            if (unreg)
            {
                WindowsIntegration.UnregisterPath(exeDir);
                WindowsIntegration.UnregisterFileAssociations();
            }
            else
            {
                if (regPath || regAll) WindowsIntegration.RegisterPath(exeDir);
                if (regMd || regAll) WindowsIntegration.RegisterFileAssociations(exePath, regAll);
            }

            if (hasStatus || regPath || regMd || regAll || unreg)
            {
                WindowsStatusInfo status = WindowsIntegration.GetStatus(exePath);
                JavaScriptSerializer json = new JavaScriptSerializer();
                Console.WriteLine(json.Serialize(status));
            }

            return true;
        }

        private static string[] ResolveFileArguments(string[] args)
        {
            List<string> files = new List<string>();
            if (args == null) return files.ToArray();

            for (int i = 0; i < args.Length; i++)
            {
                string raw = args[i];
                if (string.IsNullOrEmpty(raw) || raw.StartsWith("--")) continue;
                try
                {
                    string full = Path.GetFullPath(raw);
                    if (File.Exists(full))
                    {
                        files.Add(full);
                    }
                }
                catch
                {
                }
            }
            return files.ToArray();
        }

        private static void SendFilesToRunningInstance(string[] files)
        {
            try
            {
                using (NamedPipeClientStream client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out))
                {
                    client.Connect(1200);
                    JavaScriptSerializer json = new JavaScriptSerializer();
                    byte[] payload = Encoding.UTF8.GetBytes(json.Serialize(files ?? new string[0]));
                    client.Write(payload, 0, payload.Length);
                    client.Flush();
                }
            }
            catch
            {
            }
        }

        private static void RunPipeServer(MainForm form)
        {
            JavaScriptSerializer json = new JavaScriptSerializer();
            while (!form.IsDisposed)
            {
                try
                {
                    using (NamedPipeServerStream server = new NamedPipeServerStream(PipeName, PipeDirection.In))
                    {
                        server.WaitForConnection();
                        using (MemoryStream ms = new MemoryStream())
                        {
                            byte[] buf = new byte[4096];
                            int read;
                            while ((read = server.Read(buf, 0, buf.Length)) > 0)
                            {
                                ms.Write(buf, 0, read);
                            }
                            string raw = Encoding.UTF8.GetString(ms.ToArray());
                            string[] paths = string.IsNullOrEmpty(raw)
                                ? new string[0]
                                : json.Deserialize<string[]>(raw);
                            form.OpenExternalFiles(paths);
                        }
                    }
                }
                catch
                {
                    Thread.Sleep(100);
                }
            }
        }
    }
}
