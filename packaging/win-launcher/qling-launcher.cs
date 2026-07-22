// Minimal qling.exe launcher for WinGet portable installs.
// Spawns bundled runtime\node.exe with package\dist\index.js + args.
// Target: .NET Framework 4.x (csc.exe), no extra runtime required on modern Windows.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

internal static class Program
{
    private static int Main(string[] args)
    {
        string baseDir = ResolveBaseDirectory();
        string node = Path.Combine(baseDir, "runtime", "node.exe");
        string entry = Path.Combine(baseDir, "package", "dist", "index.js");

        if (!File.Exists(node))
        {
            Console.Error.WriteLine("[qling] Bundled Node runtime not found:");
            Console.Error.WriteLine("  " + node);
            return 1;
        }
        if (!File.Exists(entry))
        {
            Console.Error.WriteLine("[qling] Package entry not found:");
            Console.Error.WriteLine("  " + entry);
            return 1;
        }

        var argBuilder = new StringBuilder();
        AppendQuoted(argBuilder, entry);
        foreach (string a in args)
        {
            argBuilder.Append(' ');
            AppendQuoted(argBuilder, a);
        }

        var psi = new ProcessStartInfo
        {
            FileName = node,
            Arguments = argBuilder.ToString(),
            UseShellExecute = false,
            WorkingDirectory = Directory.GetCurrentDirectory(),
        };

        using (Process p = Process.Start(psi))
        {
            if (p == null)
            {
                Console.Error.WriteLine("[qling] Failed to start Node runtime.");
                return 1;
            }
            p.WaitForExit();
            return p.ExitCode;
        }
    }

    private static string ResolveBaseDirectory()
    {
        try
        {
            string executablePath = Assembly.GetExecutingAssembly().Location;
            string finalPath = ResolveFinalPath(executablePath);
            string directory = Path.GetDirectoryName(finalPath);
            if (!string.IsNullOrEmpty(directory)) return directory;
        }
        catch
        {
            // Preserve the existing launcher diagnostics if final-path lookup is unavailable.
        }
        return AppDomain.CurrentDomain.BaseDirectory;
    }

    private static string ResolveFinalPath(string path)
    {
        using (SafeFileHandle handle = CreateFile(
            path,
            0,
            FileShare.Read | FileShare.Write | FileShare.Delete,
            IntPtr.Zero,
            FileMode.Open,
            0,
            IntPtr.Zero))
        {
            if (handle.IsInvalid) return path;

            var buffer = new StringBuilder(512);
            uint length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
            if (length == 0) return path;
            if (length >= buffer.Capacity)
            {
                buffer = new StringBuilder((int)length + 1);
                length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
                if (length == 0 || length >= buffer.Capacity) return path;
            }

            string finalPath = buffer.ToString();
            const string uncPrefix = @"\\?\UNC\";
            const string localPrefix = @"\\?\";
            if (finalPath.StartsWith(uncPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return @"\\" + finalPath.Substring(uncPrefix.Length);
            }
            if (finalPath.StartsWith(localPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return finalPath.Substring(localPrefix.Length);
            }
            return finalPath;
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string fileName,
        uint desiredAccess,
        FileShare shareMode,
        IntPtr securityAttributes,
        FileMode creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(
        SafeFileHandle file,
        StringBuilder filePath,
        uint filePathLength,
        uint flags);

    private static void AppendQuoted(StringBuilder sb, string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            sb.Append("\"\"");
            return;
        }
        bool needsQuotes = value.IndexOfAny(new[] { ' ', '\t', '"' }) >= 0;
        if (!needsQuotes)
        {
            sb.Append(value);
            return;
        }
        sb.Append('"');
        foreach (char c in value)
        {
            if (c == '"') sb.Append('\\');
            sb.Append(c);
        }
        sb.Append('"');
    }
}
