namespace SingleDrive.Backup;

internal static class RestorePaths
{
    internal static readonly Environment.SpecialFolder[] Anchors = {
        Environment.SpecialFolder.Desktop, Environment.SpecialFolder.MyDocuments,
        Environment.SpecialFolder.MyPictures, Environment.SpecialFolder.MyMusic,
        Environment.SpecialFolder.MyVideos, Environment.SpecialFolder.UserProfile };

    internal static (string Anchor, string Suffix) Describe(string path)
    {
        path = Path.GetFullPath(path);
        foreach (var anchor in Anchors)
        {
            var basis = Environment.GetFolderPath(anchor);
            if (string.IsNullOrEmpty(basis)) continue;
            var relative = Path.GetRelativePath(basis, path);
            if (relative == ".") return (anchor.ToString(), "");
            if (!relative.StartsWith("..") && !Path.IsPathRooted(relative)) return (anchor.ToString(), relative);
        }
        return ("Absolute", "");
    }

    internal static string Suggest(string original, string anchor, string suffix)
    {
        if (Enum.TryParse<Environment.SpecialFolder>(anchor, out var known) && Anchors.Contains(known))
        {
            var basis = Environment.GetFolderPath(known);
            if (!string.IsNullOrEmpty(basis)) return string.IsNullOrEmpty(suffix) ? basis : Resolve(basis, suffix.Replace('\\', '/'));
        }
        if (Directory.Exists(Path.GetPathRoot(original))) return original;
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), Path.GetFileName(original.TrimEnd('\\')));
    }

    internal static string Resolve(string root, string relative)
    {
        var parts = relative.Split('/');
        foreach (var part in parts)
        {
            if (string.IsNullOrEmpty(part) || part is "." or ".." || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || part.EndsWith('.') || part.EndsWith(' ') ||
                System.Text.RegularExpressions.Regex.IsMatch(part, @"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                throw new IOException("O catálogo contém um caminho inválido.");
        }
        root = Path.GetFullPath(root);
        var target = Path.GetFullPath(Path.Combine(root, Path.Combine(parts)));
        if (!target.StartsWith(Path.TrimEndingDirectorySeparator(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Caminho fora do destino escolhido.");
        CheckParents(target);
        return target;
    }

    internal static void CheckParents(string path)
    {
        for (var current = path; !string.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
            if ((Directory.Exists(current) || File.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("O destino contém um link ou junção. Escolha outra pasta.");
    }
}
