using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Skimd
{
    internal sealed class MainForm : Form
    {
        private static readonly Dictionary<string, string> ImageMimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".png", "image/png" },
            { ".jpg", "image/jpeg" },
            { ".jpeg", "image/jpeg" },
            { ".gif", "image/gif" },
            { ".webp", "image/webp" },
            { ".svg", "image/svg+xml" },
            { ".bmp", "image/bmp" },
            { ".ico", "image/x-icon" },
            { ".avif", "image/avif" }
        };

        private readonly string _exePath;
        private readonly string _exeDir;
        private readonly BridgeHandler _bridge;
        private readonly WebView2 _webView;
        private readonly JavaScriptSerializer _json;

        private readonly HashSet<string> _watchedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, FileSystemWatcher> _dirWatchers = new Dictionary<string, FileSystemWatcher>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, DateTime> _suppressedWrites = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, System.Threading.Timer> _debounceTimers = new Dictionary<string, System.Threading.Timer>(StringComparer.OrdinalIgnoreCase);
        private readonly object _watchLock = new object();
        private bool _webReady;

        public MainForm(string exePath, string[] startupFiles)
        {
            _exePath = exePath;
            _exeDir = Path.GetDirectoryName(exePath) ?? AppDomain.CurrentDomain.BaseDirectory;
            _bridge = new BridgeHandler(this, _exePath, startupFiles);
            _json = new JavaScriptSerializer();

            Text = "Skimd";
            BackColor = Color.FromArgb(18, 18, 18);
            StartPosition = FormStartPosition.CenterScreen;
            Width = 1140;
            Height = 760;
            MinimumSize = new Size(640, 440);

            try
            {
                Icon = Icon.ExtractAssociatedIcon(_exePath);
            }
            catch
            {
            }

            RestoreWindowBounds();

            _webView = new WebView2();
            _webView.Dock = DockStyle.Fill;
            _webView.DefaultBackgroundColor = Color.FromArgb(18, 18, 18);
            Controls.Add(_webView);

            Load += OnFormLoad;
            FormClosing += OnFormClosing;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            NativeMethods.ApplyTitleBarDarkMode(Handle, true);
        }

        private async void OnFormLoad(object sender, EventArgs e)
        {
            try
            {
                string userDataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Skimd",
                    "WebView2"
                );
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userDataDir);
                await _webView.EnsureCoreWebView2Async(env);

                CoreWebView2 core = _webView.CoreWebView2;
                core.Settings.AreDefaultContextMenusEnabled = true;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
#if DEBUG
                core.Settings.AreDevToolsEnabled = true;
#else
                core.Settings.AreDevToolsEnabled = false;
#endif

                string appDir = Path.Combine(_exeDir, "app");
                if (!Directory.Exists(appDir))
                {
                    MessageBox.Show(
                        "Skimd UI bundle was not found at:\n" + appDir,
                        "Skimd",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                core.SetVirtualHostNameToFolderMapping(
                    "skimd.local",
                    appDir,
                    CoreWebView2HostResourceAccessKind.Allow
                );

                core.AddWebResourceRequestedFilter("https://skimd-asset.local/*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += OnWebResourceRequested;
                core.WebMessageReceived += OnWebMessageReceived;

                _webReady = true;
                core.Navigate("https://skimd.local/index.html");
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Failed to initialize Microsoft Edge WebView2.\n\n" + ex.Message,
                    "Skimd",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        private void OnWebResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            try
            {
                Uri uri = new Uri(e.Request.Uri);
                string localPath = ExtractQueryParam(uri.Query, "path");
                if (string.IsNullOrEmpty(localPath) || !File.Exists(localPath))
                {
                    e.Response = _webView.CoreWebView2.Environment.CreateWebResourceResponse(null, 404, "Not Found", "");
                    return;
                }

                string ext = Path.GetExtension(localPath);
                string mime;
                if (!ImageMimeTypes.TryGetValue(ext, out mime))
                {
                    e.Response = _webView.CoreWebView2.Environment.CreateWebResourceResponse(null, 403, "Forbidden", "");
                    return;
                }

                byte[] bytes = File.ReadAllBytes(localPath);
                MemoryStream stream = new MemoryStream(bytes);
                e.Response = _webView.CoreWebView2.Environment.CreateWebResourceResponse(
                    stream,
                    200,
                    "OK",
                    "Content-Type: " + mime
                );
            }
            catch
            {
                e.Response = _webView.CoreWebView2.Environment.CreateWebResourceResponse(null, 500, "Error", "");
            }
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string reqId = null;
            try
            {
                Dictionary<string, object> msg = _json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                if (msg == null) return;

                object reqIdObj;
                if (msg.TryGetValue("reqId", out reqIdObj) && reqIdObj != null)
                {
                    reqId = reqIdObj.ToString();
                }

                object actionObj;
                string action = msg.TryGetValue("action", out actionObj) && actionObj != null ? actionObj.ToString() : string.Empty;

                if (action == "dropFiles")
                {
                    HandleDroppedFiles(e.AdditionalObjects);
                    return;
                }

                Dictionary<string, object> payload = null;
                object payloadObj;
                if (msg.TryGetValue("payload", out payloadObj))
                {
                    payload = payloadObj as Dictionary<string, object>;
                }

                object result = _bridge.HandleRequest(action, payload);
                if (!string.IsNullOrEmpty(reqId))
                {
                    SendResponse(reqId, true, result, null);
                }
            }
            catch (Exception ex)
            {
                if (!string.IsNullOrEmpty(reqId))
                {
                    SendResponse(reqId, false, null, ex.Message);
                }
            }
        }

        private void HandleDroppedFiles(IReadOnlyList<object> additionalObjects)
        {
            if (additionalObjects == null || additionalObjects.Count == 0) return;
            List<string> paths = new List<string>();
            for (int i = 0; i < additionalObjects.Count; i++)
            {
                CoreWebView2File file = additionalObjects[i] as CoreWebView2File;
                if (file != null && !string.IsNullOrEmpty(file.Path) && File.Exists(file.Path))
                {
                    paths.Add(file.Path);
                }
            }
            if (paths.Count > 0)
            {
                PushEvent("openFile", new Dictionary<string, object> { { "paths", paths.ToArray() } });
            }
        }

        public void OpenExternalFiles(string[] paths)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string[]>(OpenExternalFiles), new object[] { paths });
                return;
            }

            if (WindowState == FormWindowState.Minimized)
            {
                NativeMethods.ShowWindow(Handle, 9);
            }
            Activate();
            NativeMethods.SetForegroundWindow(Handle);

            if (paths != null && paths.Length > 0 && _webReady)
            {
                PushEvent("openFile", new Dictionary<string, object> { { "paths", paths } });
            }
        }

        public void ApplyNativeTheme(bool isLight, string bgHex)
        {
            NativeMethods.ApplyTitleBarDarkMode(Handle, !isLight);
            Color bg = isLight ? Color.FromArgb(243, 243, 243) : Color.FromArgb(18, 18, 18);
            if (!string.IsNullOrEmpty(bgHex))
            {
                try
                {
                    bg = ColorTranslator.FromHtml(bgHex);
                }
                catch
                {
                }
            }
            BackColor = bg;
            if (_webView != null) _webView.DefaultBackgroundColor = bg;
        }

        public void ShowPrintUi()
        {
            if (_webView != null && _webView.CoreWebView2 != null)
            {
                _webView.CoreWebView2.ShowPrintUI(CoreWebView2PrintDialogKind.Browser);
            }
        }

        public void WatchFile(string fullPath)
        {
            string dir = Path.GetDirectoryName(fullPath);
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return;

            lock (_watchLock)
            {
                _watchedFiles.Add(fullPath);
                if (_dirWatchers.ContainsKey(dir)) return;

                FileSystemWatcher watcher = new FileSystemWatcher(dir);
                watcher.NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName;
                watcher.IncludeSubdirectories = false;
                watcher.Changed += OnWatchedFileChanged;
                watcher.Renamed += OnWatchedFileRenamed;
                watcher.EnableRaisingEvents = true;
                _dirWatchers[dir] = watcher;
            }
        }

        public void SuppressWatchBriefly(string fullPath)
        {
            lock (_watchLock)
            {
                _suppressedWrites[fullPath] = DateTime.UtcNow.AddMilliseconds(900);
            }
        }

        private void OnWatchedFileChanged(object sender, FileSystemEventArgs e)
        {
            TriggerDebouncedWatch(e.FullPath);
        }

        private void OnWatchedFileRenamed(object sender, RenamedEventArgs e)
        {
            TriggerDebouncedWatch(e.FullPath);
        }

        private void TriggerDebouncedWatch(string fullPath)
        {
            lock (_watchLock)
            {
                if (!_watchedFiles.Contains(fullPath)) return;
                DateTime until;
                if (_suppressedWrites.TryGetValue(fullPath, out until) && DateTime.UtcNow < until)
                {
                    return;
                }

                System.Threading.Timer oldTimer;
                if (_debounceTimers.TryGetValue(fullPath, out oldTimer))
                {
                    oldTimer.Dispose();
                }

                _debounceTimers[fullPath] = new System.Threading.Timer(delegate
                {
                    if (IsDisposed || !IsHandleCreated) return;
                    try
                    {
                        BeginInvoke(new Action(delegate
                        {
                            PushEvent("externalFileChanged", new Dictionary<string, object> { { "path", fullPath } });
                        }));
                    }
                    catch
                    {
                    }
                }, null, 220, System.Threading.Timeout.Infinite);
            }
        }

        private void SendResponse(string reqId, bool ok, object data, string error)
        {
            Dictionary<string, object> envelope = new Dictionary<string, object>();
            envelope["reqId"] = reqId;
            envelope["ok"] = ok;
            if (ok) envelope["data"] = data;
            else envelope["error"] = error;
            _webView.CoreWebView2.PostWebMessageAsJson(_bridge.Serialize(envelope));
        }

        private void PushEvent(string eventName, object data)
        {
            if (_webView == null || _webView.CoreWebView2 == null) return;
            Dictionary<string, object> envelope = new Dictionary<string, object>();
            envelope["event"] = eventName;
            envelope["data"] = data;
            _webView.CoreWebView2.PostWebMessageAsJson(_bridge.Serialize(envelope));
        }

        private void RestoreWindowBounds()
        {
            Dictionary<string, object> cfg = _bridge.LoadStoredConfig();
            object winObj;
            if (!cfg.TryGetValue("window", out winObj)) return;
            Dictionary<string, object> win = winObj as Dictionary<string, object>;
            if (win == null) return;

            int w = ReadInt(win, "width", 1140);
            int h = ReadInt(win, "height", 760);
            Width = Math.Max(640, w);
            Height = Math.Max(440, h);

            int x = ReadInt(win, "x", int.MinValue);
            int y = ReadInt(win, "y", int.MinValue);
            if (x != int.MinValue && y != int.MinValue)
            {
                Rectangle bounds = new Rectangle(x, y, Width, Height);
                bool onScreen = false;
                foreach (Screen s in Screen.AllScreens)
                {
                    if (s.WorkingArea.IntersectsWith(bounds))
                    {
                        onScreen = true;
                        break;
                    }
                }
                if (onScreen)
                {
                    StartPosition = FormStartPosition.Manual;
                    Location = new Point(x, y);
                }
            }

            object maxObj;
            if (win.TryGetValue("maximized", out maxObj) && maxObj is bool && (bool)maxObj)
            {
                WindowState = FormWindowState.Maximized;
            }
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            try
            {
                Rectangle bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                Dictionary<string, object> cfg = _bridge.LoadStoredConfig();
                Dictionary<string, object> win = new Dictionary<string, object>();
                win["x"] = bounds.X;
                win["y"] = bounds.Y;
                win["width"] = bounds.Width;
                win["height"] = bounds.Height;
                win["maximized"] = (WindowState == FormWindowState.Maximized);
                cfg["window"] = win;
                _bridge.SaveStoredConfig(cfg);
            }
            catch
            {
            }

            lock (_watchLock)
            {
                foreach (FileSystemWatcher w in _dirWatchers.Values) w.Dispose();
                _dirWatchers.Clear();
                foreach (System.Threading.Timer t in _debounceTimers.Values) t.Dispose();
                _debounceTimers.Clear();
            }
        }

        private static int ReadInt(Dictionary<string, object> dict, string key, int fallback)
        {
            object val;
            if (dict.TryGetValue(key, out val) && val != null)
            {
                int parsed;
                if (int.TryParse(val.ToString(), out parsed)) return parsed;
            }
            return fallback;
        }

        private static string ExtractQueryParam(string query, string name)
        {
            if (string.IsNullOrEmpty(query)) return string.Empty;
            string q = query.TrimStart('?');
            string[] pairs = q.Split('&');
            for (int i = 0; i < pairs.Length; i++)
            {
                string[] kv = pairs[i].Split(new char[] { '=' }, 2);
                if (kv.Length == 2 && string.Equals(kv[0], name, StringComparison.OrdinalIgnoreCase))
                {
                    return Uri.UnescapeDataString(kv[1].Replace('+', ' '));
                }
            }
            return string.Empty;
        }
    }
}
