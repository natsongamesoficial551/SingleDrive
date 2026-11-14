using SingleDrive.Backup;

var root = Path.Combine(Path.GetTempPath(), "singledrive-path-test-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
try
{
    var destination = RestorePaths.Resolve(root, "Projetos/2026/contrato.pdf");
    if (destination != Path.Combine(root, "Projetos", "2026", "contrato.pdf")) throw new Exception("Subpastas não preservadas.");
    foreach (var invalid in new[] { "../fora.txt", "/absoluto.txt", "C:/fora.txt", "a\\b", "a//b", "CON.txt", "aux", "a/arquivo.", "arquivo ", "arquivo:stream", "a/../../fora", "a/*" })
    {
        try { RestorePaths.Resolve(root, invalid); throw new Exception("Caminho inseguro aceito: " + invalid); }
        catch (IOException) { }
    }
    var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
    if (!string.IsNullOrEmpty(documents))
    {
        var original = Path.Combine(documents, "Projetos", "SingleDrive");
        var described = RestorePaths.Describe(original);
        if (described.Anchor != "MyDocuments" || RestorePaths.Suggest(@"Z:\Users\Antigo\Documents\Projetos\SingleDrive", described.Anchor, described.Suffix) != original)
            throw new Exception("Remapeamento de perfil falhou.");
    }
    var existing = Path.Combine(root, "existente.txt");
    File.WriteAllText(existing, "preservar");
    var temp = Path.Combine(root, "novo.tmp"); File.WriteAllText(temp, "novo");
    try { File.Move(temp, existing, false); throw new Exception("Sobrescrita permitida."); } catch (IOException) { }
    if (File.ReadAllText(existing) != "preservar") throw new Exception("Arquivo existente alterado.");
    Console.WriteLine("OK: subpastas, 12 caminhos inválidos, perfil atual e preservação de arquivos existentes.");
}
finally { Directory.Delete(root, true); }
