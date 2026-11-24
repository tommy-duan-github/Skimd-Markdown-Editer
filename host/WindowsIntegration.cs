using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using Microsoft.Win32;

namespace Skimd
{
    internal sealed class WindowsStatusInfo
    {
        public string exePath;
        public string exeDir;
        public bool inUserPath;
        public bool mdRegisteredToSkimd;
        public string mdUserChoiceProgId;
        public bool mdLockedByOtherApp;
        public bool structuredRegistered;
    }

    internal static class WindowsIntegration
    {
        private const string ProgIdMarkdown = "Skimd.Markdown";
        private const string ProgIdYaml = "Skimd.YAML";
        private const string ProgIdJson = "Skimd.JSON";
        private const string UserChoicePath = @"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice";

        public static WindowsStatusInfo GetStatus(string exePath)
        {
            string exeDir = Path.GetDirectoryName(exePath) ?? string.Empty;
            WindowsStatusInfo info = new WindowsStatusInfo();
            info.exePath = exePath;
            info.exeDir = exeDir;
            info.inUserPath = IsInUserPath(exeDir);
            info.mdUserChoiceProgId = ReadMdUserChoice();
            info.mdRegisteredToSkimd = CheckProgIdCommand(ProgIdMarkdown, exePath);
            info.structuredRegistered = CheckProgIdCommand(ProgIdYaml, exePath) && CheckProgIdCommand(ProgIdJson, exePath);
            info.mdLockedByOtherApp = !string.IsNullOrEmpty(info.mdUserChoiceProgId)
                && !string.Equals(info.mdUserChoiceProgId, ProgIdMarkdown, StringComparison.OrdinalIgnoreCase);
            return info;
        }

        public static bool IsInUserPath(string exeDir)
        {
            string normTarget = NormalizeDir(exeDir);
            using (RegistryKey envKey = Registry.CurrentUser.OpenSubKey("Environment", false))
            {
                if (envKey == null) return false;
                string raw = envKey.GetValue("Path", "", RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
                if (string.IsNullOrEmpty(raw)) return false;
                string[] parts = raw.Split(';');
                for (int i = 0; i < parts.Length; i++)
                {
                    if (string.Equals(NormalizeDir(parts[i]), normTarget, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        public static void RegisterPath(string exeDir)
        {
            string normTarget = NormalizeDir(exeDir);
            using (RegistryKey envKey = Registry.CurrentUser.CreateSubKey("Environment"))
            {
                string raw = envKey.GetValue("Path", "", RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
                List<string> cleaned = new List<string>();
                bool alreadyPresent = false;
                if (!string.IsNullOrEmpty(raw))
                {
                    string[] parts = raw.Split(';');
                    for (int i = 0; i < parts.Length; i++)
                    {
                        string entry = parts[i].Trim();
                        if (string.IsNullOrEmpty(entry)) continue;
                        if (string.Equals(NormalizeDir(entry), normTarget, StringComparison.OrdinalIgnoreCase))
                        {
                            if (!alreadyPresent)
                            {
                                cleaned.Add(exeDir);
                                alreadyPresent = true;
                            }
                        }
                        else
                        {
                            cleaned.Add(entry);
                        }
                    }
                }
                if (!alreadyPresent)
                {
                    cleaned.Add(exeDir);
                }
                envKey.SetValue("Path", string.Join(";", cleaned.ToArray()), RegistryValueKind.ExpandString);
            }
            NativeMethods.BroadcastEnvironmentChange();
        }

        public static void UnregisterPath(string exeDir)
        {
            string normTarget = NormalizeDir(exeDir);
            using (RegistryKey envKey = Registry.CurrentUser.OpenSubKey("Environment", true))
            {
                if (envKey == null) return;
                string raw = envKey.GetValue("Path", "", RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
                if (string.IsNullOrEmpty(raw)) return;
                string[] parts = raw.Split(';');
                List<string> kept = new List<string>();
                for (int i = 0; i < parts.Length; i++)
                {
                    string entry = parts[i].Trim();
                    if (string.IsNullOrEmpty(entry)) continue;
                    if (!string.Equals(NormalizeDir(entry), normTarget, StringComparison.OrdinalIgnoreCase))
                    {
                        kept.Add(entry);
                    }
                }
                envKey.SetValue("Path", string.Join(";", kept.ToArray()), RegistryValueKind.ExpandString);
            }
            NativeMethods.BroadcastEnvironmentChange();
        }

        public static void RegisterFileAssociations(string exePath, bool includeStructured)
        {
            string openCmd = string.Format("\"{0}\" \"%1\"", exePath);
            string iconVal = string.Format("\"{0}\",0", exePath);

            CreateProgId(ProgIdMarkdown, "Markdown Document", iconVal, openCmd);
            BindExtension(".md", ProgIdMarkdown);
            BindExtension(".markdown", ProgIdMarkdown);
            BindExtension(".mdown", ProgIdMarkdown);
            BindExtension(".mkd", ProgIdMarkdown);

            if (includeStructured)
            {
                CreateProgId(ProgIdYaml, "YAML Document", iconVal, openCmd);
                BindExtension(".yaml", ProgIdYaml);
                BindExtension(".yml", ProgIdYaml);

                CreateProgId(ProgIdJson, "JSON Document", iconVal, openCmd);
                BindExtension(".json", ProgIdJson);
                BindExtension(".jsonc", ProgIdJson);
            }

            // Register Application & Capabilities so Skimd appears in Windows Default Apps
            using (RegistryKey appKey = Registry.CurrentUser.CreateSubKey(@"Software\Classes\Applications\Skimd.exe"))
            {
                appKey.SetValue("FriendlyAppName", "Skimd");
                using (RegistryKey cmdKey = appKey.CreateSubKey(@"shell\open\command"))
                {
                    cmdKey.SetValue("", openCmd);
                }
                using (RegistryKey typesKey = appKey.CreateSubKey("SupportedTypes"))
                {
                    typesKey.SetValue(".md", "");
                    typesKey.SetValue(".markdown", "");
                    typesKey.SetValue(".mdown", "");
                    typesKey.SetValue(".mkd", "");
                    typesKey.SetValue(".yaml", "");
                    typesKey.SetValue(".yml", "");
                    typesKey.SetValue(".json", "");
                    typesKey.SetValue(".jsonc", "");
                    typesKey.SetValue(".txt", "");
                }
            }

            using (RegistryKey capKey = Registry.CurrentUser.CreateSubKey(@"Software\Skimd\Capabilities"))
            {
                capKey.SetValue("ApplicationName", "Skimd");
                capKey.SetValue("ApplicationDescription", "Lightweight, fast Markdown and structured text reader.");
                using (RegistryKey assocKey = capKey.CreateSubKey("FileAssociations"))
                {
                    assocKey.SetValue(".md", ProgIdMarkdown);
                    assocKey.SetValue(".markdown", ProgIdMarkdown);
                    assocKey.SetValue(".mdown", ProgIdMarkdown);
                    assocKey.SetValue(".mkd", ProgIdMarkdown);
                    if (includeStructured)
                    {
                        assocKey.SetValue(".yaml", ProgIdYaml);
                        assocKey.SetValue(".yml", ProgIdYaml);
                        assocKey.SetValue(".json", ProgIdJson);
                        assocKey.SetValue(".jsonc", ProgIdJson);
                    }
                }
            }

            using (RegistryKey regApps = Registry.CurrentUser.CreateSubKey(@"Software\RegisteredApplications"))
            {
                regApps.SetValue("Skimd", @"Software\Skimd\Capabilities");
            }

            NativeMethods.NotifyAssociationsChanged();
        }

        public static void UnregisterFileAssociations()
        {
            UnbindExtension(".md", ProgIdMarkdown);
            UnbindExtension(".markdown", ProgIdMarkdown);
            UnbindExtension(".mdown", ProgIdMarkdown);
            UnbindExtension(".mkd", ProgIdMarkdown);
            UnbindExtension(".yaml", ProgIdYaml);
            UnbindExtension(".yml", ProgIdYaml);
            UnbindExtension(".json", ProgIdJson);
            UnbindExtension(".jsonc", ProgIdJson);

            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\" + ProgIdMarkdown, false);
            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\" + ProgIdYaml, false);
            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\" + ProgIdJson, false);
            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\Applications\Skimd.exe", false);
            Registry.CurrentUser.DeleteSubKeyTree(@"Software\Skimd", false);

            using (RegistryKey regApps = Registry.CurrentUser.OpenSubKey(@"Software\RegisteredApplications", true))
            {
                if (regApps != null)
                {
                    regApps.DeleteValue("Skimd", false);
                }
            }

            NativeMethods.NotifyAssociationsChanged();
        }

        public static void OpenDefaultAppsSettings()
        {
            Process.Start(new ProcessStartInfo("ms-settings:defaultapps") { UseShellExecute = true });
        }

        private static void CreateProgId(string progId, string description, string iconVal, string openCmd)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + progId))
            {
                key.SetValue("", description);
                using (RegistryKey iconKey = key.CreateSubKey("DefaultIcon"))
                {
                    iconKey.SetValue("", iconVal);
                }
                using (RegistryKey cmdKey = key.CreateSubKey(@"shell\open\command"))
                {
                    cmdKey.SetValue("", openCmd);
                }
            }
        }

        private static void BindExtension(string ext, string progId)
        {
            using (RegistryKey extKey = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + ext))
            {
                extKey.SetValue("", progId);
                using (RegistryKey owKey = extKey.CreateSubKey("OpenWithProgids"))
                {
                    owKey.SetValue(progId, new byte[0], RegistryValueKind.None);
                }
            }
        }

        private static void UnbindExtension(string ext, string progId)
        {
            using (RegistryKey extKey = Registry.CurrentUser.OpenSubKey(@"Software\Classes\" + ext, true))
            {
                if (extKey == null) return;
                string current = extKey.GetValue("") as string;
                if (string.Equals(current, progId, StringComparison.OrdinalIgnoreCase))
                {
                    extKey.DeleteValue("", false);
                }
                using (RegistryKey owKey = extKey.OpenSubKey("OpenWithProgids", true))
                {
                    if (owKey != null)
                    {
                        owKey.DeleteValue(progId, false);
                    }
                }
            }
        }

        private static bool CheckProgIdCommand(string progId, string exePath)
        {
            using (RegistryKey cmdKey = Registry.CurrentUser.OpenSubKey(@"Software\Classes\" + progId + @"\shell\open\command", false))
            {
                if (cmdKey == null) return false;
                string cmd = cmdKey.GetValue("") as string;
                if (string.IsNullOrEmpty(cmd)) return false;
                return cmd.IndexOf(exePath, StringComparison.OrdinalIgnoreCase) >= 0;
            }
        }

        private static string ReadMdUserChoice()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(UserChoicePath, false))
            {
                if (key == null) return string.Empty;
                return (key.GetValue("ProgId") as string) ?? string.Empty;
            }
        }

        private static string NormalizeDir(string dir)
        {
            if (string.IsNullOrEmpty(dir)) return string.Empty;
            return dir.Trim().Trim('"').TrimEnd('\\', '/');
        }
    }
}
