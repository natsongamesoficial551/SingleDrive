# MSI do SingleDrive

O pacote x64 instala no diretório **Arquivos de Programas**, cria atalhos no menu Iniciar e na Área de Trabalho e aparece em **Aplicativos instalados**. O aplicativo inclui o runtime .NET 8 e o rclone. Na primeira montagem, ele verifica o SHA-256 do instalador oficial do WinFsp que acompanha o pacote e o abre se o driver estiver ausente.

## Gerar o pacote

Use o SDK .NET 8, WiX CLI 6.0.2 e a extensão `WixToolset.UI.wixext/6.0.2`. Execute os comandos WiX e o script a partir do mesmo diretório.

1. Separe `rclone.exe` e a licença MIT (`Licenca-rclone.txt`) do [rclone v1.76.0](https://downloads.rclone.org/v1.76.0/).
2. Use o MSI oficial do [WinFsp 2.2.26323](https://github.com/winfsp/winfsp/releases/tag/v2.2) com o nome `WinFsp.msi`. Guarde na mesma pasta a licença `Licenca-WinFsp.txt` e o arquivo oficial de código-fonte `WinFsp-v2.2-source.tar.gz`.
3. Informe os diretórios ao script de build. Use uma versão de produto maior ao publicar uma atualização do MSI.

```powershell
wix extension add WixToolset.UI.wixext/6.0.2
.\desktop\installer\Build-Msi.ps1 -RcloneFolder .\rclone -WinFspFolder .\winfsp -WorkDirectory .\work -OutputMsi .\outputs\SingleDrive-Windows-x64.msi
```

Após instalar, abra o SingleDrive pelo menu Iniciar, entre com Google e clique em **Criar disco remoto**. O Windows pode pedir permissão de administrador para instalar o WinFsp. A desinstalação do SingleDrive preserva o driver compartilhado e os arquivos do Google Drive.

Em **Vincular Discord**, clique em **Abrir no navegador**. O aplicativo abre a página no navegador padrão do Windows. Se for solicitado, entre no navegador com o mesmo perfil SingleDrive para concluir a vinculação.
