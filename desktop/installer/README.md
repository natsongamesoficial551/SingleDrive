# MSI do SingleDrive

O MSI x64 tem telas e ícones do SingleDrive, permite escolher o diretório de instalação e cria atalhos no menu Iniciar e na Área de Trabalho. Para **Reparar** ou **Remover**, abra de novo o MSI da versão instalada. O SingleDrive também aparece em **Aplicativos instalados** do Windows.

O pacote contém o runtime .NET 8, o rclone e o instalador oficial do driver WinFsp. Ao concluir a instalação com **Abrir SingleDrive e preparar a unidade** marcado, o aplicativo abre e verifica se falta o WinFsp. Se necessário, ele valida o SHA-256 do pacote incluído e solicita permissão de administrador para instalar o driver. O mesmo preparo ocorre ao abrir o aplicativo pelo menu Iniciar após uma instalação silenciosa. As dependências já vêm no MSI.

Ao abrir um MSI mais recente, o Windows Installer detecta a versão instalada e atualiza o aplicativo. As configurações em `%LOCALAPPDATA%\SingleDrive` são preservadas. Se a atualização falhar, o Windows Installer pode restaurar a versão anterior.

## Gerar o pacote

Use o SDK .NET 8, WiX CLI 6.0.2 e as extensões de interface e utilidades do WiX. Execute os comandos WiX e o script a partir do mesmo diretório.

1. Separe `rclone.exe` e a licença MIT (`Licenca-rclone.txt`) do [rclone v1.76.0](https://downloads.rclone.org/v1.76.0/).
2. Use o MSI oficial do [WinFsp 2.2.26323](https://github.com/winfsp/winfsp/releases/tag/v2.2) com o nome `WinFsp.msi`. Guarde na mesma pasta a licença `Licenca-WinFsp.txt` e o arquivo oficial de código-fonte `WinFsp-v2.2-source.tar.gz`.
3. Informe os diretórios ao script de build. Use uma versão de produto maior ao publicar uma atualização do MSI.

```powershell
wix extension add WixToolset.UI.wixext/6.0.2
wix extension add WixToolset.Util.wixext/6.0.2
.\desktop\installer\Build-Msi.ps1 -RcloneFolder .\rclone -WinFspFolder .\winfsp -WorkDirectory .\work -OutputMsi .\outputs\SingleDrive-Windows-x64.msi
```

Após instalar, entre com Google e clique em **Criar disco remoto** ou **Conectar disco remoto**. Nos próximos logins do Windows, o agente inicia em segundo plano para montar a unidade autorizada assim que a rede e o servidor estiverem disponíveis. A opção **Iniciar agente ao entrar no Windows** fica na janela do agente. A remoção do SingleDrive preserva o driver compartilhado, as preferências locais e os arquivos do Google Drive.

Em **Vincular Discord**, clique em **Abrir no navegador**. O aplicativo abre a página no navegador padrão do Windows. Se for solicitado, entre no navegador com o mesmo perfil SingleDrive para concluir a vinculação.
