// Minimal qling.exe launcher for WinGet portable installs.
// Spawns bundled runtime\node.exe with package\dist\index.js + args.
// Target: .NET Framework 4.x (csc.exe), no extra runtime required on modern Windows.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

internal static class Program
{
    private static int Main(string[] args)
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
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
