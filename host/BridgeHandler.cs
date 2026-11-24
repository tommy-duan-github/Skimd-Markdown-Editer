using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Skimd
{
    internal sealed class BridgeHandler
    {
        private static readonly HashSet<string> SupportedExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".md", ".markdown", ".mdx", ".mdown", ".mkd",
            ".json", ".jsonc", ".yaml", ".yml",
            ".csv", ".tsv", ".toml", ".ini", ".cfg", ".conf",
            ".txt", ".log"
        };

        private static readonly DateTime UnixEpoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        private readonly MainForm _form;
        private readonly string _exePath;
        private readonly string _exeDir;
        private readonly string _configPath;
        private readonly string[] _startupFiles;
        private readonly JavaScriptSerializer _json;

        public BridgeHandler(MainForm form, string exePath, string[] startupFiles)
        {
            _form = form;
            _exePath = exePath;
            _exeDir = Path.GetDirectoryName(exePath) ?? AppDomain.CurrentDomain.BaseDirectory;
            _startupFiles = startupFiles ?? new string[0];
            _configPath = ResolveConfigPath(_exeDir);
            _json = new JavaScriptSerializer();
            _json.MaxJsonLength = 67108864;
        }

        public string Serialize(object obj)
        {
            return _json.Serialize(obj);
        }

        public Dictionary<string, object> LoadStoredConfig()
        {
            try
            {
                if (File.Exists(_configPath))
                {
                    string raw = File.ReadAllText(_configPath, Encoding.UTF8);
                    Dictionary<string, object> parsed = _json.Deserialize<Dictionary<string, object>>(raw);
                    if (parsed != null) return parsed;
                }
            }
            catch
            {
            }
            return new Dictionary<string, object>();
        }

        public void SaveStoredConfig(Dictionary<string, object> config)
        {
            try
            {
                string dir = Path.GetDirectoryName(_configPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                File.WriteAllText(_configPath, _json.Serialize(config), new UTF8Encoding(false));
            }
            catch
            {
            }
        }

        public object HandleRequest(string action, Dictionary<string, object> payload)
        {
            switch (action)
            {
                case "ready":
                    Dictionary<string, object> readyRes = new Dictionary<string, object>();
                    readyRes["config"] = LoadStoredConfig();
                    readyRes["windowsStatus"] = WindowsIntegration.GetStatus(_exePath);
                    readyRes["startupFiles"] = _startupFiles;
                    readyRes["appVersion"] = "1.0.0-beta.2";
                    return readyRes;

                case "readFile":
                    return ReadFilePayload(GetString(payload, "path"));

                case "writeFile":
                    return WriteFilePayload(GetString(payload, "path"), GetString(payload, "content"));

                case "openFileDialog":
                    return OpenFileDialogPayload();

                case "saveFileDialog":
                    return SaveFileDialogPayload(GetString(payload, "suggestedName"), GetString(payload, "content"));

                case "listDir":
                    return ListDirPayload(GetString(payload, "dir"), GetBool(payload, "showHidden", false));

                case "pickFolderDialog":
                    return PickFolderDialogPayload();

                case "downloadImage":
                    return DownloadImagePayload(
                        GetString(payload, "url"),
                        GetString(payload, "docDir"),
                        GetString(payload, "saveMode"),
                        GetString(payload, "globalFolder")
                    );

                case "saveConfig":
                    Dictionary<string, object> cfg = GetDict(payload, "config");
                    if (cfg != null)
                    {
                        Dictionary<string, object> existing = LoadStoredConfig();
                        foreach (KeyValuePair<string, object> kv in cfg)
                        {
                            existing[kv.Key] = kv.Value;
                        }
                        SaveStoredConfig(existing);
                    }
                    return true;

                case "setTheme":
                    string theme = GetString(payload, "theme");
                    string bgHex = GetString(payload, "bgHex");
                    _form.ApplyNativeTheme(string.Equals(theme, "light", StringComparison.OrdinalIgnoreCase), bgHex);
                    return true;

                case "setWindowTitle":
                    string title = GetString(payload, "title");
                    if (!string.IsNullOrEmpty(title)) _form.Text = title;
                    return true;

                case "openExternal":
                    string url = GetString(payload, "url");
                    if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                        url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    {
                        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                    }
                    return true;

                case "revealInExplorer":
                    string revealPath = GetString(payload, "path");
                    if (!string.IsNullOrEmpty(revealPath) && File.Exists(revealPath))
                    {
                        Process.Start("explorer.exe", string.Format("/select,\"{0}\"", revealPath));
                    }
                    return true;

                case "getWindowsStatus":
                    return WindowsIntegration.GetStatus(_exePath);

                case "registerWindows":
                    bool regPath = GetBool(payload, "path", true);
                    bool regMd = GetBool(payload, "md", true);
                    bool regStruct = GetBool(payload, "structured", false);
                    if (regPath) WindowsIntegration.RegisterPath(_exeDir);
                    if (regMd || regStruct) WindowsIntegration.RegisterFileAssociations(_exePath, regStruct);
                    return WindowsIntegration.GetStatus(_exePath);

                case "unregisterWindows":
                    WindowsIntegration.UnregisterPath(_exeDir);
                    WindowsIntegration.UnregisterFileAssociations();
                    return WindowsIntegration.GetStatus(_exePath);

                case "openDefaultApps":
                    WindowsIntegration.OpenDefaultAppsSettings();
                    return true;

                case "print":
                    _form.ShowPrintUi();
                    return true;

                default:
                    throw new InvalidOperationException("Unknown action: " + action);
            }
        }

        private Dictionary<string, object> ReadFilePayload(string path)
        {
            if (string.IsNullOrEmpty(path)) throw new ArgumentException("Missing file path.");
            string fullPath = Path.GetFullPath(path);
            if (!File.Exists(fullPath)) throw new FileNotFoundException("File not found.", fullPath);

            string content = ReadTextSmart(fullPath);
            FileInfo fi = new FileInfo(fullPath);
            _form.WatchFile(fullPath);

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["path"] = fullPath;
            res["name"] = fi.Name;
            res["dir"] = fi.DirectoryName ?? string.Empty;
            res["content"] = content;
            res["mtimeMs"] = ToUnixMs(fi.LastWriteTimeUtc);
            res["size"] = fi.Length;
            return res;
        }

        private Dictionary<string, object> WriteFilePayload(string path, string content)
        {
            if (string.IsNullOrEmpty(path)) throw new ArgumentException("Missing file path.");
            string fullPath = Path.GetFullPath(path);
            _form.SuppressWatchBriefly(fullPath);
            File.WriteAllText(fullPath, content ?? string.Empty, new UTF8Encoding(false));
            FileInfo fi = new FileInfo(fullPath);
            _form.WatchFile(fullPath);

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["mtimeMs"] = ToUnixMs(fi.LastWriteTimeUtc);
            res["size"] = fi.Length;
            return res;
        }

        private object OpenFileDialogPayload()
        {
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Title = "Open Document — Skimd";
                dlg.Filter = "Supported Files (*.md;*.markdown;*.yaml;*.yml;*.json;*.jsonc;*.csv;*.tsv;*.toml;*.ini;*.txt;*.log)|*.md;*.markdown;*.mdx;*.mdown;*.mkd;*.yaml;*.yml;*.json;*.jsonc;*.csv;*.tsv;*.toml;*.ini;*.cfg;*.conf;*.txt;*.log|Markdown (*.md;*.markdown)|*.md;*.markdown;*.mdx;*.mdown;*.mkd|YAML & JSON (*.yaml;*.yml;*.json;*.jsonc)|*.yaml;*.yml;*.json;*.jsonc|All Files (*.*)|*.*";
                if (dlg.ShowDialog(_form) != DialogResult.OK)
                {
                    return null;
                }
                return ReadFilePayload(dlg.FileName);
            }
        }

        private object SaveFileDialogPayload(string suggestedName, string content)
        {
            using (SaveFileDialog dlg = new SaveFileDialog())
            {
                dlg.Title = "Save Document — Skimd";
                dlg.FileName = string.IsNullOrEmpty(suggestedName) ? "Untitled.md" : suggestedName;
                dlg.Filter = "Markdown (*.md)|*.md|YAML (*.yaml;*.yml)|*.yaml;*.yml|JSON (*.json)|*.json|Text (*.txt)|*.txt|All Files (*.*)|*.*";
                if (dlg.ShowDialog(_form) != DialogResult.OK)
                {
                    return null;
                }
                _form.SuppressWatchBriefly(dlg.FileName);
                File.WriteAllText(dlg.FileName, content ?? string.Empty, new UTF8Encoding(false));
                return ReadFilePayload(dlg.FileName);
            }
        }

        private List<Dictionary<string, object>> ListDirPayload(string dir, bool showHidden)
        {
            List<Dictionary<string, object>> items = new List<Dictionary<string, object>>();
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return items;

            string[] files = Directory.GetFiles(dir);
            Array.Sort(files, StringComparer.OrdinalIgnoreCase);

            int count = 0;
            for (int i = 0; i < files.Length && count < 500; i++)
            {
                string ext = Path.GetExtension(files[i]);
                if (!SupportedExtensions.Contains(ext)) continue;
                FileInfo fi = new FileInfo(files[i]);
                if (!showHidden)
                {
                    if (fi.Name.StartsWith(".")) continue;
                    if ((fi.Attributes & (FileAttributes.Hidden | FileAttributes.System)) != 0) continue;
                }
                Dictionary<string, object> row = new Dictionary<string, object>();
                row["path"] = fi.FullName;
                row["name"] = fi.Name;
                row["format"] = MapFormatName(ext);
                row["size"] = fi.Length;
                row["mtimeMs"] = ToUnixMs(fi.LastWriteTimeUtc);
                items.Add(row);
                count++;
            }
            return items;
        }

        private object PickFolderDialogPayload()
        {
            using (FolderBrowserDialog dlg = new FolderBrowserDialog())
            {
                dlg.Description = "Select global folder for localised images";
                if (dlg.ShowDialog(_form) != DialogResult.OK)
                {
                    return null;
                }
                return dlg.SelectedPath;
            }
        }

        private Dictionary<string, object> DownloadImagePayload(string url, string docDir, string saveMode, string globalFolder)
        {
            if (string.IsNullOrEmpty(url) ||
                (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                 !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)))
            {
                throw new ArgumentException("Only http:// or https:// image URLs can be localised.");
            }

            string targetDir;
            bool isRelativeFolder = false;
            if (string.Equals(saveMode, "global", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrEmpty(globalFolder))
            {
                targetDir = Path.GetFullPath(globalFolder);
            }
            else if (!string.IsNullOrEmpty(docDir))
            {
                targetDir = Path.Combine(Path.GetFullPath(docDir), "image");
                isRelativeFolder = true;
            }
            else if (!string.IsNullOrEmpty(globalFolder))
            {
                targetDir = Path.GetFullPath(globalFolder);
            }
            else
            {
                throw new InvalidOperationException("Save the Markdown file first, or set a global image folder in Settings.");
            }

            if (!Directory.Exists(targetDir))
            {
                Directory.CreateDirectory(targetDir);
            }

            ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; // TLS 1.2

            byte[] data;
            string contentType = string.Empty;
            using (WebClient client = new WebClient())
            {
                client.Headers.Add("User-Agent", "Skimd/1.0");
                data = client.DownloadData(url);
                if (client.ResponseHeaders != null)
                {
                    contentType = client.ResponseHeaders["Content-Type"] ?? string.Empty;
                }
            }

            if (data == null || data.Length == 0)
            {
                throw new InvalidOperationException("Downloaded image is empty.");
            }
            if (data.Length > 50 * 1024 * 1024)
            {
                throw new InvalidOperationException("Image exceeds 50 MB size limit.");
            }

            Uri uri = new Uri(url);
            string rawName = Path.GetFileName(uri.AbsolutePath);
            string baseName = SanitizeFileName(Path.GetFileNameWithoutExtension(rawName));
            if (string.IsNullOrEmpty(baseName)) baseName = "image";

            string ext = Path.GetExtension(rawName);
            if (!IsKnownImageExtension(ext))
            {
                ext = ExtensionFromContentType(contentType);
            }
            if (string.IsNullOrEmpty(ext)) ext = ".png";

            string fileName = baseName + ext;
            string destPath = Path.Combine(targetDir, fileName);
            int counter = 1;
            while (File.Exists(destPath))
            {
                fileName = string.Format("{0}-{1}{2}", baseName, counter, ext);
                destPath = Path.Combine(targetDir, fileName);
                counter++;
            }

            File.WriteAllBytes(destPath, data);

            string markdownRef = isRelativeFolder
                ? "./image/" + fileName
                : destPath.Replace('\\', '/');

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["localPath"] = destPath;
            res["markdownRef"] = markdownRef;
            res["fileName"] = fileName;
            return res;
        }

        private static string SanitizeFileName(string name)
        {
            if (string.IsNullOrEmpty(name)) return string.Empty;
            char[] invalid = Path.GetInvalidFileNameChars();
            StringBuilder sb = new StringBuilder(name.Length);
            for (int i = 0; i < name.Length; i++)
            {
                char ch = name[i];
                bool bad = Array.IndexOf(invalid, ch) >= 0 || ch == ' ';
                sb.Append(bad ? '-' : ch);
            }
            string cleaned = sb.ToString().Trim('-', '.');
            if (cleaned.Length > 64) cleaned = cleaned.Substring(0, 64);
            return cleaned;
        }

        private static bool IsKnownImageExtension(string ext)
        {
            if (string.IsNullOrEmpty(ext)) return false;
            string lower = ext.ToLowerInvariant();
            return lower == ".png" || lower == ".jpg" || lower == ".jpeg" ||
                   lower == ".gif" || lower == ".webp" || lower == ".svg" ||
                   lower == ".bmp" || lower == ".ico" || lower == ".avif";
        }

        private static string ExtensionFromContentType(string contentType)
        {
            if (string.IsNullOrEmpty(contentType)) return ".png";
            string lower = contentType.ToLowerInvariant();
            if (lower.Contains("jpeg") || lower.Contains("jpg")) return ".jpg";
            if (lower.Contains("webp")) return ".webp";
            if (lower.Contains("gif")) return ".gif";
            if (lower.Contains("svg")) return ".svg";
            if (lower.Contains("avif")) return ".avif";
            if (lower.Contains("bmp")) return ".bmp";
            if (lower.Contains("icon")) return ".ico";
            return ".png";
        }

        private static string MapFormatName(string ext)
        {
            if (string.IsNullOrEmpty(ext)) return "text";
            string lower = ext.ToLowerInvariant();
            if (lower == ".md" || lower == ".markdown" || lower == ".mdx" || lower == ".mdown" || lower == ".mkd") return "markdown";
            if (lower == ".json" || lower == ".jsonc") return "json";
            if (lower == ".yaml" || lower == ".yml") return "yaml";
            if (lower == ".csv" || lower == ".tsv") return "csv";
            if (lower == ".toml" || lower == ".ini" || lower == ".cfg" || lower == ".conf") return "toml";
            return "text";
        }

        private static string ReadTextSmart(string path)
        {
            using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (StreamReader sr = new StreamReader(fs, Encoding.UTF8, true))
            {
                return sr.ReadToEnd();
            }
        }

        private static double ToUnixMs(DateTime utc)
        {
            return (utc - UnixEpoch).TotalMilliseconds;
        }

        private static string ResolveConfigPath(string exeDir)
        {
            // Portable builds carry portable.flag next to Skimd.exe; installed builds persist config in %LOCALAPPDATA%\Skimd so upgrades preserve settings.
            string portableFlag = Path.Combine(exeDir, "portable.flag");
            if (File.Exists(portableFlag))
            {
                string portableDataDir = Path.Combine(exeDir, "data");
                try
                {
                    if (!Directory.Exists(portableDataDir)) Directory.CreateDirectory(portableDataDir);
                    string probe = Path.Combine(portableDataDir, ".write_test");
                    File.WriteAllText(probe, "1");
                    File.Delete(probe);
                    return Path.Combine(portableDataDir, "config.json");
                }
                catch
                {
                }
            }

            string appData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Skimd"
            );
            return Path.Combine(appData, "config.json");
        }

        private static string GetString(Dictionary<string, object> dict, string key)
        {
            object val;
            if (dict != null && dict.TryGetValue(key, out val) && val != null)
            {
                return val.ToString();
            }
            return string.Empty;
        }

        private static bool GetBool(Dictionary<string, object> dict, string key, bool fallback)
        {
            object val;
            if (dict != null && dict.TryGetValue(key, out val) && val != null)
            {
                bool parsed;
                if (val is bool) return (bool)val;
                if (bool.TryParse(val.ToString(), out parsed)) return parsed;
            }
            return fallback;
        }

        private static Dictionary<string, object> GetDict(Dictionary<string, object> dict, string key)
        {
            object val;
            if (dict != null && dict.TryGetValue(key, out val))
            {
                return val as Dictionary<string, object>;
            }
            return null;
        }
    }
}
