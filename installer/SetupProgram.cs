using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace SkimdSetup
{
    internal sealed class InstallOptions
    {
        public string InstallDir;
        public bool AddToPath;
        public bool AssociateMd;
        public bool AssociateStructured;
        public bool StartMenuShortcut;
        public bool DesktopShortcut;
    }

    internal static class NativeSetup
    {
        public const int DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19;
        public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

        [DllImport("dwmapi.dll", PreserveSig = true)]
        public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        public static void EnableDarkTitleBar(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return;
            int val = 1;
            int hr = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref val, Marshal.SizeOf(typeof(int)));
            if (hr != 0)
            {
                DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1, ref val, Marshal.SizeOf(typeof(int)));
            }
        }
    }

    internal static class SetupEngine
    {
        public const string PayloadResourceName = "Skimd.payload.zip";
        private const string UninstallRegKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Skimd";
        private const string InstallerStateRegKey = @"Software\Skimd\Installer";

        public static string GetDefaultInstallDir()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                @"Programs\Skimd"
            );
        }

        public static void ReadExistingInstall(out string installedVersion, out InstallOptions defaults)
        {
            installedVersion = string.Empty;
            defaults = new InstallOptions();
            defaults.InstallDir = GetDefaultInstallDir();
            defaults.AddToPath = true;
            defaults.AssociateMd = true;
            defaults.AssociateStructured = false;
            defaults.StartMenuShortcut = true;
            defaults.DesktopShortcut = false;

            using (RegistryKey uninst = Registry.CurrentUser.OpenSubKey(UninstallRegKey, false))
            {
                if (uninst != null)
                {
                    string ver = uninst.GetValue("DisplayVersion") as string;
                    string loc = uninst.GetValue("InstallLocation") as string;
                    if (!string.IsNullOrEmpty(ver)) installedVersion = ver;
                    if (!string.IsNullOrEmpty(loc)) defaults.InstallDir = loc;
                }
            }

            using (RegistryKey state = Registry.CurrentUser.OpenSubKey(InstallerStateRegKey, false))
            {
                if (state != null)
                {
                    defaults.AddToPath = ReadBool(state, "AddToPath", defaults.AddToPath);
                    defaults.AssociateMd = ReadBool(state, "AssociateMd", defaults.AssociateMd);
                    defaults.AssociateStructured = ReadBool(state, "AssociateStructured", defaults.AssociateStructured);
                    defaults.StartMenuShortcut = ReadBool(state, "StartMenuShortcut", defaults.StartMenuShortcut);
                    defaults.DesktopShortcut = ReadBool(state, "DesktopShortcut", defaults.DesktopShortcut);
                }
            }
        }

        public static bool VerifyEmbeddedPayload(out string message)
        {
            try
            {
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResourceName))
                {
                    if (stream == null)
                    {
                        message = "Embedded payload resource not found.";
                        return false;
                    }
                    using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                    {
                        bool hasExe = false;
                        bool hasIndex = false;
                        bool hasCoreDll = false;
                        bool hasWinFormsDll = false;
                        bool hasLoaderDll = false;
                        bool hasPortableFlag = false;

                        foreach (ZipArchiveEntry entry in archive.Entries)
                        {
                            string norm = entry.FullName.Replace('\\', '/').TrimStart('/');
                            if (string.Equals(norm, "Skimd.exe", StringComparison.OrdinalIgnoreCase)) hasExe = true;
                            else if (string.Equals(norm, "app/index.html", StringComparison.OrdinalIgnoreCase)) hasIndex = true;
                            else if (string.Equals(norm, "Microsoft.Web.WebView2.Core.dll", StringComparison.OrdinalIgnoreCase)) hasCoreDll = true;
                            else if (string.Equals(norm, "Microsoft.Web.WebView2.WinForms.dll", StringComparison.OrdinalIgnoreCase)) hasWinFormsDll = true;
                            else if (string.Equals(norm, "WebView2Loader.dll", StringComparison.OrdinalIgnoreCase)) hasLoaderDll = true;
                            else if (string.Equals(norm, "portable.flag", StringComparison.OrdinalIgnoreCase)) hasPortableFlag = true;
                        }

                        if (!hasExe || !hasIndex || !hasCoreDll || !hasWinFormsDll || !hasLoaderDll)
                        {
                            message = "Payload is incomplete.";
                            return false;
                        }
                        if (hasPortableFlag)
                        {
                            message = "Payload should not contain portable.flag.";
                            return false;
                        }

                        message = string.Format("Payload OK ({0} entries, version {1})", archive.Entries.Count, InstallerVersion.Version);
                        return true;
                    }
                }
            }
            catch (Exception ex)
            {
                message = ex.Message;
                return false;
            }
        }

        public static void StopRunningSkimd(string installDir)
        {
            string normDir = Path.GetFullPath(installDir).TrimEnd('\\') + "\\";
            Process[] procs = Process.GetProcessesByName("Skimd");
            List<Process> matching = new List<Process>();

            for (int i = 0; i < procs.Length; i++)
            {
                Process p = procs[i];
                try
                {
                    string pPath = p.MainModule != null ? p.MainModule.FileName : string.Empty;
                    if (string.IsNullOrEmpty(pPath) || pPath.StartsWith(normDir, StringComparison.OrdinalIgnoreCase))
                    {
                        matching.Add(p);
                        p.CloseMainWindow();
                    }
                    else
                    {
                        p.Dispose();
                    }
                }
                catch
                {
                    matching.Add(p);
                }
            }

            if (matching.Count == 0) return;

            DateTime deadline = DateTime.UtcNow.AddMilliseconds(2500);
            while (DateTime.UtcNow < deadline)
            {
                bool anyAlive = false;
                for (int i = 0; i < matching.Count; i++)
                {
                    try
                    {
                        if (!matching[i].HasExited) anyAlive = true;
                    }
                    catch
                    {
                    }
                }
                if (!anyAlive) break;
                Thread.Sleep(120);
            }

            for (int i = 0; i < matching.Count; i++)
            {
                try
                {
                    if (!matching[i].HasExited)
                    {
                        matching[i].Kill();
                        matching[i].WaitForExit(1500);
                    }
                }
                catch
                {
                }
                finally
                {
                    matching[i].Dispose();
                }
            }
        }

        public static void InstallOrUpgrade(InstallOptions opts, Action<string, int> progress)
        {
            string installDir = Path.GetFullPath(opts.InstallDir.Trim());
            if (string.IsNullOrEmpty(installDir))
            {
                throw new ArgumentException("Please choose a valid installation directory.");
            }

            progress("Stopping any running Skimd instance…", 12);
            StopRunningSkimd(installDir);

            progress("Preparing destination folder…", 24);
            if (!Directory.Exists(installDir))
            {
                Directory.CreateDirectory(installDir);
            }

            // Remove stale app/ assets before extracting fresh build (preserves any existing user data)
            string appDir = Path.Combine(installDir, "app");
            if (Directory.Exists(appDir))
            {
                Directory.Delete(appDir, true);
            }

            long totalBytes = 0;
            progress("Extracting Skimd v" + InstallerVersion.Version + "…", 42);
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResourceName))
            {
                if (stream == null) throw new InvalidOperationException("Embedded payload missing.");
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    int total = archive.Entries.Count;
                    int idx = 0;
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        idx++;
                        string rel = entry.FullName.Replace('/', '\\').TrimStart('\\');
                        if (string.IsNullOrEmpty(rel)) continue;

                        string destPath = Path.GetFullPath(Path.Combine(installDir, rel));
                        if (!destPath.StartsWith(installDir.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }

                        if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\"))
                        {
                            if (!Directory.Exists(destPath)) Directory.CreateDirectory(destPath);
                            continue;
                        }

                        string parent = Path.GetDirectoryName(destPath);
                        if (!string.IsNullOrEmpty(parent) && !Directory.Exists(parent))
                        {
                            Directory.CreateDirectory(parent);
                        }

                        using (Stream inStream = entry.Open())
                        using (FileStream outStream = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None))
                        {
                            inStream.CopyTo(outStream);
                        }
                        totalBytes += entry.Length;

                        if (idx % 6 == 0 && total > 0)
                        {
                            int pct = 42 + (int)((idx * 34.0) / total);
                            progress("Extracting files…", pct);
                        }
                    }
                }
            }

            string exePath = Path.Combine(installDir, "Skimd.exe");
            if (!File.Exists(exePath))
            {
                throw new InvalidOperationException("Skimd.exe was not extracted properly.");
            }

            progress("Installing uninstaller & metadata…", 80);
            string uninstallerPath = Path.Combine(installDir, "Uninstall.exe");
            string selfExe = Assembly.GetExecutingAssembly().Location;
            if (!string.IsNullOrEmpty(selfExe) &&
                !string.Equals(Path.GetFullPath(selfExe), Path.GetFullPath(uninstallerPath), StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(selfExe, uninstallerPath, true);
            }

            // Re-apply Windows integration cleanly for the installed Skimd.exe
            progress("Configuring Windows integration…", 88);
            RunSkimdCli(exePath, "--unregister");
            List<string> regArgs = new List<string>();
            if (opts.AddToPath) regArgs.Add("--register-path");
            if (opts.AssociateStructured) regArgs.Add("--register-all");
            else if (opts.AssociateMd) regArgs.Add("--register-md");

            if (regArgs.Count > 0)
            {
                // Avoid adding PATH twice if --register-all was selected without AddToPath
                if (opts.AssociateStructured && !opts.AddToPath)
                {
                    RunSkimdCli(exePath, "--register-all");
                    RunSkimdCli(exePath, "--unregister");
                    RunSkimdCli(exePath, "--register-md");
                }
                else
                {
                    RunSkimdCli(exePath, string.Join(" ", regArgs.ToArray()));
                }
            }

            progress("Updating shortcuts & Windows Apps list…", 94);
            UpdateShortcuts(exePath, opts);
            WriteUninstallRegistry(installDir, exePath, uninstallerPath, totalBytes, opts);

            progress("Skimd v" + InstallerVersion.Version + " is ready.", 100);
        }

        public static void Uninstall(string installDir, bool removeDirAsync)
        {
            string resolvedDir = Path.GetFullPath(installDir);
            string exePath = Path.Combine(resolvedDir, "Skimd.exe");

            StopRunningSkimd(resolvedDir);

            if (File.Exists(exePath))
            {
                RunSkimdCli(exePath, "--unregister");
            }

            DeleteShortcut(GetStartMenuShortcutPath());
            DeleteShortcut(GetDesktopShortcutPath());

            Registry.CurrentUser.DeleteSubKeyTree(UninstallRegKey, false);
            Registry.CurrentUser.DeleteSubKeyTree(InstallerStateRegKey, false);

            if (removeDirAsync && Directory.Exists(resolvedDir))
            {
                string selfExe = Assembly.GetExecutingAssembly().Location;
                bool runningFromInstallDir = !string.IsNullOrEmpty(selfExe) &&
                    Path.GetFullPath(selfExe).StartsWith(resolvedDir.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);

                if (runningFromInstallDir)
                {
                    // Schedule removal after Uninstall.exe exits
                    ProcessStartInfo psi = new ProcessStartInfo("cmd.exe",
                        string.Format("/C timeout /t 2 /nobreak > NUL & rmdir /S /Q \"{0}\"", resolvedDir));
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    psi.WindowStyle = ProcessWindowStyle.Hidden;
                    Process.Start(psi);
                }
                else
                {
                    Directory.Delete(resolvedDir, true);
                }
            }
        }

        private static void RunSkimdCli(string exePath, string arguments)
        {
            ProcessStartInfo psi = new ProcessStartInfo(exePath, arguments);
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            using (Process p = Process.Start(psi))
            {
                if (p != null) p.WaitForExit(8000);
            }
        }

        private static void WriteUninstallRegistry(
            string installDir,
            string exePath,
            string uninstallerPath,
            long totalBytes,
            InstallOptions opts)
        {
            int kb = (int)Math.Max(1024, totalBytes / 1024);
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallRegKey))
            {
                key.SetValue("DisplayName", "Skimd");
                key.SetValue("DisplayVersion", InstallerVersion.Version);
                key.SetValue("Publisher", "Skimd");
                key.SetValue("InstallLocation", installDir);
                key.SetValue("DisplayIcon", exePath + ",0");
                key.SetValue("UninstallString", string.Format("\"{0}\" --uninstall", uninstallerPath));
                key.SetValue("QuietUninstallString", string.Format("\"{0}\" --uninstall --silent", uninstallerPath));
                key.SetValue("EstimatedSize", kb, RegistryValueKind.DWord);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }

            using (RegistryKey state = Registry.CurrentUser.CreateSubKey(InstallerStateRegKey))
            {
                state.SetValue("AddToPath", opts.AddToPath ? 1 : 0, RegistryValueKind.DWord);
                state.SetValue("AssociateMd", opts.AssociateMd ? 1 : 0, RegistryValueKind.DWord);
                state.SetValue("AssociateStructured", opts.AssociateStructured ? 1 : 0, RegistryValueKind.DWord);
                state.SetValue("StartMenuShortcut", opts.StartMenuShortcut ? 1 : 0, RegistryValueKind.DWord);
                state.SetValue("DesktopShortcut", opts.DesktopShortcut ? 1 : 0, RegistryValueKind.DWord);
            }
        }

        private static void UpdateShortcuts(string exePath, InstallOptions opts)
        {
            string startMenuPath = GetStartMenuShortcutPath();
            if (opts.StartMenuShortcut)
            {
                CreateShortcut(startMenuPath, exePath, "Skimd — Fast Markdown Reader");
            }
            else
            {
                DeleteShortcut(startMenuPath);
            }

            string desktopPath = GetDesktopShortcutPath();
            if (opts.DesktopShortcut)
            {
                CreateShortcut(desktopPath, exePath, "Skimd — Fast Markdown Reader");
            }
            else
            {
                DeleteShortcut(desktopPath);
            }
        }

        private static string GetStartMenuShortcutPath()
        {
            string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            return Path.Combine(programs, "Skimd.lnk");
        }

        private static string GetDesktopShortcutPath()
        {
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            return Path.Combine(desktop, "Skimd.lnk");
        }

        private static void CreateShortcut(string lnkPath, string targetExe, string description)
        {
            try
            {
                string dir = Path.GetDirectoryName(lnkPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                object shell = Activator.CreateInstance(shellType);
                object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
                Type scType = shortcut.GetType();
                scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetExe });
                scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { Path.GetDirectoryName(targetExe) });
                scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { targetExe + ",0" });
                scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
                scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
            }
            catch
            {
            }
        }

        private static void DeleteShortcut(string lnkPath)
        {
            try
            {
                if (File.Exists(lnkPath)) File.Delete(lnkPath);
            }
            catch
            {
            }
        }

        private static bool ReadBool(RegistryKey key, string name, bool fallback)
        {
            object val = key.GetValue(name);
            if (val == null) return fallback;
            int num;
            if (int.TryParse(val.ToString(), out num)) return num != 0;
            return fallback;
        }
    }

    internal sealed class SetupForm : Form
    {
        private readonly string _installedVersion;
        private readonly InstallOptions _defaults;
        private readonly bool _uninstallMode;

        private TextBox _pathBox;
        private Button _browseBtn;
        private CheckBox _chkPath;
        private CheckBox _chkMd;
        private CheckBox _chkStructured;
        private CheckBox _chkStartMenu;
        private CheckBox _chkDesktop;
        private ProgressBar _progressBar;
        private Label _statusLabel;
        private Button _primaryBtn;
        private Button _secondaryBtn;
        private bool _completed;
        private bool _busy;

        public SetupForm(string installedVersion, InstallOptions defaults, bool uninstallMode)
        {
            _installedVersion = installedVersion ?? string.Empty;
            _defaults = defaults;
            _uninstallMode = uninstallMode;

            bool isUpgrade = !string.IsNullOrEmpty(_installedVersion) && !_uninstallMode;

            Text = _uninstallMode ? "Uninstall Skimd" : (isUpgrade ? "Upgrade Skimd" : "Install Skimd");
            BackColor = Color.FromArgb(18, 18, 18);
            ForeColor = Color.FromArgb(245, 245, 245);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(500, _uninstallMode ? 240 : 418);
            Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            try
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
            }

            BuildUi(isUpgrade);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            NativeSetup.EnableDarkTitleBar(Handle);
        }

        private void BuildUi(bool isUpgrade)
        {
            Panel headerCard = new Panel();
            headerCard.BackColor = Color.FromArgb(28, 28, 28);
            headerCard.Location = new Point(20, 18);
            headerCard.Size = new Size(460, 72);

            Label titleLbl = new Label();
            titleLbl.AutoSize = true;
            titleLbl.Font = new Font("Segoe UI", 14f, FontStyle.Bold);
            titleLbl.ForeColor = Color.FromArgb(245, 245, 245);
            titleLbl.Location = new Point(18, 13);
            titleLbl.Text = _uninstallMode
                ? "Uninstall Skimd"
                : (isUpgrade ? "Upgrade Skimd" : "Install Skimd");

            Label subLbl = new Label();
            subLbl.AutoSize = true;
            subLbl.Font = new Font("Segoe UI", 9.2f, FontStyle.Regular);
            subLbl.ForeColor = Color.FromArgb(168, 168, 168);
            subLbl.Location = new Point(20, 42);
            if (_uninstallMode)
            {
                subLbl.Text = string.Format("Remove Skimd v{0} and its Windows integrations",
                    string.IsNullOrEmpty(_installedVersion) ? InstallerVersion.Version : _installedVersion);
            }
            else if (isUpgrade)
            {
                subLbl.Text = string.Format("Installed: v{0}  ->  New: v{1} (settings preserved)",
                    _installedVersion, InstallerVersion.Version);
            }
            else
            {
                subLbl.Text = string.Format("Version {0}  ·  Lightweight Markdown & Text Reader", InstallerVersion.Version);
            }

            headerCard.Controls.Add(titleLbl);
            headerCard.Controls.Add(subLbl);
            Controls.Add(headerCard);

            if (!_uninstallMode)
            {
                Label dirLbl = new Label();
                dirLbl.AutoSize = true;
                dirLbl.ForeColor = Color.FromArgb(168, 168, 168);
                dirLbl.Location = new Point(22, 106);
                dirLbl.Text = "Install location";
                Controls.Add(dirLbl);

                _pathBox = new TextBox();
                _pathBox.BackColor = Color.FromArgb(28, 28, 28);
                _pathBox.ForeColor = Color.FromArgb(245, 245, 245);
                _pathBox.BorderStyle = BorderStyle.FixedSingle;
                _pathBox.Location = new Point(22, 128);
                _pathBox.Size = new Size(368, 26);
                _pathBox.Text = _defaults.InstallDir;
                Controls.Add(_pathBox);

                _browseBtn = new Button();
                _browseBtn.Text = "Browse…";
                _browseBtn.FlatStyle = FlatStyle.Flat;
                _browseBtn.FlatAppearance.BorderSize = 0;
                _browseBtn.BackColor = Color.FromArgb(39, 39, 39);
                _browseBtn.ForeColor = Color.FromArgb(245, 245, 245);
                _browseBtn.Location = new Point(398, 126);
                _browseBtn.Size = new Size(82, 28);
                _browseBtn.Click += OnBrowseClick;
                Controls.Add(_browseBtn);

                Panel optsCard = new Panel();
                optsCard.BackColor = Color.FromArgb(28, 28, 28);
                optsCard.Location = new Point(20, 168);
                optsCard.Size = new Size(460, 146);

                _chkPath = MakeCheck("Add Skimd to Windows PATH (skimd command)", 16, 14, _defaults.AddToPath);
                _chkMd = MakeCheck("Associate .md & .markdown files with Skimd", 16, 40, _defaults.AssociateMd);
                _chkStructured = MakeCheck("Also associate .yaml & .json files", 16, 66, _defaults.AssociateStructured);
                _chkStartMenu = MakeCheck("Create Start Menu shortcut", 16, 92, _defaults.StartMenuShortcut);
                _chkDesktop = MakeCheck("Create Desktop shortcut", 16, 118, _defaults.DesktopShortcut);

                optsCard.Controls.Add(_chkPath);
                optsCard.Controls.Add(_chkMd);
                optsCard.Controls.Add(_chkStructured);
                optsCard.Controls.Add(_chkStartMenu);
                optsCard.Controls.Add(_chkDesktop);
                Controls.Add(optsCard);
            }

            int footerY = _uninstallMode ? 112 : 330;

            _statusLabel = new Label();
            _statusLabel.AutoSize = false;
            _statusLabel.Location = new Point(22, footerY);
            _statusLabel.Size = new Size(456, 20);
            _statusLabel.ForeColor = Color.FromArgb(168, 168, 168);
            _statusLabel.Text = _uninstallMode ? "Click Uninstall to remove Skimd from this PC." : "Ready to install.";
            Controls.Add(_statusLabel);

            _progressBar = new ProgressBar();
            _progressBar.Location = new Point(22, footerY + 24);
            _progressBar.Size = new Size(456, 10);
            _progressBar.Minimum = 0;
            _progressBar.Maximum = 100;
            _progressBar.Style = ProgressBarStyle.Continuous;
            Controls.Add(_progressBar);

            _secondaryBtn = new Button();
            _secondaryBtn.FlatStyle = FlatStyle.Flat;
            _secondaryBtn.FlatAppearance.BorderSize = 0;
            _secondaryBtn.BackColor = Color.FromArgb(39, 39, 39);
            _secondaryBtn.ForeColor = Color.FromArgb(245, 245, 245);
            _secondaryBtn.Location = new Point(22, footerY + 46);
            _secondaryBtn.Size = new Size(106, 34);
            _secondaryBtn.Text = isUpgrade ? "Uninstall" : "Cancel";
            _secondaryBtn.Click += OnSecondaryClick;
            Controls.Add(_secondaryBtn);

            _primaryBtn = new Button();
            _primaryBtn.FlatStyle = FlatStyle.Flat;
            _primaryBtn.FlatAppearance.BorderSize = 0;
            _primaryBtn.BackColor = Color.White;
            _primaryBtn.ForeColor = Color.FromArgb(18, 18, 18);
            _primaryBtn.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            _primaryBtn.Location = new Point(342, footerY + 46);
            _primaryBtn.Size = new Size(138, 34);
            _primaryBtn.Text = _uninstallMode ? "Uninstall" : (isUpgrade ? "Upgrade" : "Install");
            _primaryBtn.Click += OnPrimaryClick;
            Controls.Add(_primaryBtn);
        }

        private CheckBox MakeCheck(string text, int x, int y, bool checkedVal)
        {
            CheckBox cb = new CheckBox();
            cb.AutoSize = true;
            cb.ForeColor = Color.FromArgb(235, 235, 235);
            cb.Location = new Point(x, y);
            cb.Text = text;
            cb.Checked = checkedVal;
            return cb;
        }

        private void OnBrowseClick(object sender, EventArgs e)
        {
            using (FolderBrowserDialog dlg = new FolderBrowserDialog())
            {
                dlg.Description = "Choose Skimd installation folder";
                dlg.SelectedPath = _pathBox.Text;
                if (dlg.ShowDialog(this) == DialogResult.OK)
                {
                    _pathBox.Text = dlg.SelectedPath;
                }
            }
        }

        private void OnSecondaryClick(object sender, EventArgs e)
        {
            if (_busy) return;
            if (!_completed && !string.IsNullOrEmpty(_installedVersion) && !_uninstallMode)
            {
                // Run uninstall when user clicks Uninstall during an existing-install view
                RunUninstallAsync();
                return;
            }
            Close();
        }

        private void OnPrimaryClick(object sender, EventArgs e)
        {
            if (_busy) return;

            if (_completed)
            {
                if (!_uninstallMode)
                {
                    string exe = Path.Combine(_pathBox.Text.Trim(), "Skimd.exe");
                    if (File.Exists(exe))
                    {
                        Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true });
                    }
                }
                Close();
                return;
            }

            if (_uninstallMode)
            {
                RunUninstallAsync();
                return;
            }

            InstallOptions opts = new InstallOptions();
            opts.InstallDir = _pathBox.Text.Trim();
            opts.AddToPath = _chkPath.Checked;
            opts.AssociateMd = _chkMd.Checked;
            opts.AssociateStructured = _chkStructured.Checked;
            opts.StartMenuShortcut = _chkStartMenu.Checked;
            opts.DesktopShortcut = _chkDesktop.Checked;

            _busy = true;
            _primaryBtn.Enabled = false;
            _secondaryBtn.Enabled = false;
            if (_browseBtn != null) _browseBtn.Enabled = false;
            if (_pathBox != null) _pathBox.Enabled = false;

            Thread worker = new Thread(delegate()
            {
                try
                {
                    SetupEngine.InstallOrUpgrade(opts, delegate(string msg, int pct)
                    {
                        BeginInvoke(new Action(delegate()
                        {
                            _statusLabel.Text = msg;
                            _progressBar.Value = Math.Max(0, Math.Min(100, pct));
                        }));
                    });

                    BeginInvoke(new Action(delegate()
                    {
                        _busy = false;
                        _completed = true;
                        _primaryBtn.Enabled = true;
                        _secondaryBtn.Enabled = true;
                        _primaryBtn.Text = "Launch Skimd";
                        _secondaryBtn.Text = "Close";
                    }));
                }
                catch (Exception ex)
                {
                    BeginInvoke(new Action(delegate()
                    {
                        _busy = false;
                        _primaryBtn.Enabled = true;
                        _secondaryBtn.Enabled = true;
                        if (_browseBtn != null) _browseBtn.Enabled = true;
                        if (_pathBox != null) _pathBox.Enabled = true;
                        _statusLabel.Text = "Error: " + ex.Message;
                        MessageBox.Show(this, ex.Message, "Skimd Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }));
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private void RunUninstallAsync()
        {
            string targetDir = _pathBox != null ? _pathBox.Text.Trim() : _defaults.InstallDir;
            _busy = true;
            _primaryBtn.Enabled = false;
            _secondaryBtn.Enabled = false;
            _statusLabel.Text = "Removing Skimd…";
            _progressBar.Value = 40;

            Thread worker = new Thread(delegate()
            {
                try
                {
                    SetupEngine.Uninstall(targetDir, true);
                    BeginInvoke(new Action(delegate()
                    {
                        _busy = false;
                        _completed = true;
                        _progressBar.Value = 100;
                        _statusLabel.Text = "Skimd has been uninstalled.";
                        _primaryBtn.Enabled = true;
                        _primaryBtn.Text = "Finish";
                    }));
                }
                catch (Exception ex)
                {
                    BeginInvoke(new Action(delegate()
                    {
                        _busy = false;
                        _primaryBtn.Enabled = true;
                        _secondaryBtn.Enabled = true;
                        MessageBox.Show(this, ex.Message, "Skimd Uninstall", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }));
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }
    }

    internal static class SetupProgram
    {
        [STAThread]
        private static int Main(string[] args)
        {
            bool verifyPayload = false;
            bool silent = false;
            bool uninstall = false;

            if (args != null)
            {
                for (int i = 0; i < args.Length; i++)
                {
                    string a = args[i].Trim().ToLowerInvariant();
                    if (a == "--verify-payload") verifyPayload = true;
                    else if (a == "--silent" || a == "/s" || a == "-s") silent = true;
                    else if (a == "--uninstall" || a == "/uninstall") uninstall = true;
                }
            }

            if (verifyPayload)
            {
                string msg;
                bool ok = SetupEngine.VerifyEmbeddedPayload(out msg);
                return ok ? 0 : 1;
            }

            string installedVersion;
            InstallOptions defaults;
            SetupEngine.ReadExistingInstall(out installedVersion, out defaults);

            if (silent)
            {
                try
                {
                    if (uninstall)
                    {
                        SetupEngine.Uninstall(defaults.InstallDir, true);
                    }
                    else
                    {
                        SetupEngine.InstallOrUpgrade(defaults, delegate(string m, int p) { });
                    }
                    return 0;
                }
                catch
                {
                    return 1;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm(installedVersion, defaults, uninstall));
            return 0;
        }
    }
}
