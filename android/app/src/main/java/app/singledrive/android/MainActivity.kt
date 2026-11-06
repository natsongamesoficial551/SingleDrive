package app.singledrive.android

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.lifecycle.viewmodel.compose.viewModel

private val Green = Color(0xFF087F73)
private val Mint = Color(0xFFE5F2EC)
private val CanvasColor = Color(0xFFF5F7F5)
private val Ink = Color(0xFF203C36)

class MainActivity : ComponentActivity() {
    private var callback by mutableStateOf<Uri?>(null)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); enableEdgeToEdge(); callback = intent?.data
        setContent {
            val vm: DriveModel = viewModel()
            LaunchedEffect(callback, vm.booting, vm.working) {
                if (!vm.booting && !vm.working) callback?.let { callback = null; intent.data = null; vm.finishGoogle(it) }
            }
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme(primary = Color(0xFF72D8BF),
                background = Color(0xFF111E1A), surface = Color(0xFF192824)) else lightColorScheme(
                primary = Green, onPrimary = Color.White, primaryContainer = Mint, background = CanvasColor,
                surface = Color.White, onBackground = Ink, onSurface = Ink)) {
                SingleDriveApp(vm)
            }
        }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); callback = intent.data }
}

@Composable private fun Brand() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Surface(color = Green, shape = RoundedCornerShape(13.dp)) {
            androidx.compose.foundation.Canvas(Modifier.size(43.dp).padding(8.dp)) {
                val sx = size.width / 40f; val sy = size.height / 40f
                val p = Path().apply {
                    moveTo(29*sx, 10*sy); lineTo(16*sx,10*sy)
                    cubicTo(4*sx,10*sy,4*sx,22*sy,16*sx,22*sy); lineTo(24*sx,22*sy)
                    cubicTo(36*sx,22*sy,36*sx,32*sy,24*sx,32*sy); lineTo(11*sx,32*sy)
                }
                drawPath(p, Color.White, style = Stroke(4*sx, cap = StrokeCap.Round))
            }
        }
        Text("SingleDrive", fontWeight = FontWeight.Bold, fontSize = 23.sp, letterSpacing = (-1).sp)
    }
}

@Composable private fun SingleDriveApp(vm: DriveModel) {
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    fun browser(uri: Uri) {
        try { CustomTabsIntent.Builder().build().launchUrl(context, uri) }
        catch (_: Exception) { vm.message = "Instale ou habilite um navegador para continuar com Google." }
    }
    LaunchedEffect(vm.message) { vm.message?.let { val m = it; vm.message = null; snackbar.showSnackbar(m) } }
    var pendingDownload by remember { mutableStateOf<DriveFile?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        if (uri != null) pendingDownload?.let { vm.download(it, uri) }; pendingDownload = null
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let {
            runCatching { context.contentResolver.takePersistableUriPermission(it, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            vm.upload(it)
        }
    }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }, containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            if (vm.user != null) NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                val names = listOf("Arquivos", "Espaço", "Lixeira", "Ajustes")
                val icons = listOf(Icons.Outlined.Folder, Icons.Outlined.DonutLarge, Icons.Outlined.DeleteOutline, Icons.Outlined.Tune)
                names.forEachIndexed { index, title ->
                    NavigationBarItem(selected = vm.tab == index, onClick = { vm.navigate(index) },
                        icon = { Icon(icons[index], title) }, label = { Text(title, fontSize = 11.sp) })
                }
            }
        }) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            if (vm.booting) Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                Brand(); Spacer(Modifier.height(28.dp)); CircularProgressIndicator(); Text("Restaurando sua sessão…", Modifier.padding(16.dp))
            } else if (vm.user == null) LoginScreen(vm) { vm.google(false, false, ::browser) }
            else Column(Modifier.widthIn(max = 900.dp).fillMaxSize()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Brand(); Spacer(Modifier.weight(1f))
                    IconButton(onClick = vm::refresh, enabled = !vm.loading && !vm.working) { Icon(Icons.Outlined.Refresh, "Atualizar") }
                }
                if (vm.loading || vm.working) LinearProgressIndicator(Modifier.fillMaxWidth())
                vm.transfer?.let { label ->
                    Surface(color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.padding(horizontal = 16.dp), shape = RoundedCornerShape(14.dp)) {
                        Column(Modifier.padding(14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(label, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                TextButton(onClick = vm::cancelTransfer) { Text("Parar") }
                            }
                            if (vm.progress > 0f) LinearProgressIndicator(progress = { vm.progress }, modifier = Modifier.fillMaxWidth())
                            else LinearProgressIndicator(Modifier.fillMaxWidth())
                            Text("Mantenha o aplicativo aberto durante a transferência.", fontSize = 11.sp, modifier = Modifier.padding(top = 6.dp))
                        }
                    }
                }
                when (vm.tab) {
                    0, 2 -> FilesScreen(vm, upload = { pick.launch(arrayOf("*/*")) },
                        open = { file -> vm.openFile(file) { uri, mime ->
                            try { context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
                            catch (_: android.content.ActivityNotFoundException) { vm.message = "Nenhum aplicativo instalado abre esse tipo de arquivo. Use Salvar no dispositivo." }
                        } }, download = { file -> pendingDownload = file; save.launch(file.name) })
                    1 -> AccountsScreen(vm, false) { full -> vm.google(true, full, ::browser) }
                    3 -> AccountsScreen(vm, true) { full -> vm.google(true, full, ::browser) }
                }
            }
        }
    }
}

@Composable private fun LoginScreen(vm: DriveModel, google: () -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    // Password intentionally does not enter saved instance state.
    var password by remember { mutableStateOf("") }; var reveal by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Brand()
        Surface(color = if (isSystemInDarkTheme()) Color(0xFF20382B) else Color(0xFFE7EEE3), shape = RoundedCornerShape(24.dp)) {
            Column(Modifier.fillMaxWidth().padding(26.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("SEU ESPAÇO, EM UM SÓ LUGAR", fontSize = 10.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold)
                Text("Várias contas.\nTudo conectado.", fontSize = 36.sp, lineHeight = 39.sp, letterSpacing = (-1.5).sp)
                Text("Organize seus arquivos e acompanhe o espaço das suas contas Google Drive.", fontSize = 14.sp, lineHeight = 22.sp)
            }
        }
        Text("Bem-vindo de volta", fontWeight = FontWeight.SemiBold, fontSize = 25.sp, modifier = Modifier.padding(top = 8.dp))
        Text("Entre no seu espaço SingleDrive.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(email, { email = it }, Modifier.fillMaxWidth(), label = { Text("E-mail") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), shape = RoundedCornerShape(12.dp))
        OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Senha") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), shape = RoundedCornerShape(12.dp),
            visualTransformation = if (reveal) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = { IconButton(onClick = { reveal = !reveal }) { Icon(if (reveal) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, "Mostrar ou ocultar senha") } })
        Button(onClick = { vm.login(email, password); password = "" }, enabled = !vm.working && email.isNotBlank() && password.isNotEmpty(),
            modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(12.dp)) { Text(if (vm.working) "Aguarde…" else "Entrar") }
        OutlinedButton(onClick = google, enabled = !vm.working, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(12.dp)) {
            Icon(Icons.Outlined.AccountCircle, null); Spacer(Modifier.width(10.dp)); Text("Continuar com Google")
        }
        Text("Primeiro acesso? Continue com Google para criar sua conta.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = vm::restoreLogin, enabled = !vm.working) { Text("Tentar recuperar sessão") }
    }
}

@Composable private fun StorageCard(vm: DriveModel) {
    Surface(color = if (isSystemInDarkTheme()) Color(0xFF20382B) else Color(0xFFEAF1E7), shape = RoundedCornerShape(20.dp)) {
        Column(Modifier.fillMaxWidth().padding(22.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("SEU ARMAZENAMENTO", fontSize = 10.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold)
            Text(bytes(vm.used), fontSize = 34.sp, letterSpacing = (-1).sp)
            LinearProgressIndicator(progress = { vm.total?.let { (vm.used.toFloat() / it).coerceIn(0f, 1f) } ?: 0f }, modifier = Modifier.fillMaxWidth())
            Text("${vm.total?.let { "de ${bytes(it)}" } ?: "Capacidade ainda não informada"} · ${vm.accounts.size} conta(s) conectada(s)", fontSize = 12.sp)
        }
    }
}

@Composable private fun FilesScreen(vm: DriveModel, upload: () -> Unit, open: (DriveFile) -> Unit, download: (DriveFile) -> Unit) {
    val trash = vm.tab == 2
    var grid by rememberSaveable { mutableStateOf(false) }
    var newFolder by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf<DriveFile?>(null) }
    var move by remember { mutableStateOf<DriveFile?>(null) }
    var deleting by remember { mutableStateOf<DriveFile?>(null) }
    BackHandler(vm.path.isNotEmpty() && !trash) { vm.up() }
    val folderId = vm.path.lastOrNull()?.id
    val visibleFiles = vm.files.filter { (trash || vm.query.isNotBlank() || it.folderId == folderId) && it.name.contains(vm.query, true) }
    val visibleFolders = if (trash) emptyList() else vm.folders.filter { (vm.query.isNotBlank() || it.parentId == folderId) && it.name.contains(vm.query, true) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (!trash && vm.path.isEmpty()) item { StorageCard(vm) }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (vm.path.isNotEmpty() && !trash) IconButton(onClick = vm::up) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Pasta anterior") }
                Column(Modifier.weight(1f)) {
                    Text(if (trash) "Lixeira" else vm.path.lastOrNull()?.name ?: "Meus arquivos", fontSize = 26.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(if (trash) "Restaure arquivos removidos." else "Tudo o que importa, organizado.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { grid = !grid }) { Icon(if (grid) Icons.Outlined.ViewList else Icons.Outlined.GridView, "Alternar visualização") }
            }
        }
        item { OutlinedTextField(vm.query, { vm.query = it }, Modifier.fillMaxWidth(), placeholder = { Text("Buscar arquivos e pastas") },
            leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, shape = RoundedCornerShape(14.dp)) }
        if (!trash) item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = upload, enabled = vm.transfer == null && !vm.resumable, shape = RoundedCornerShape(12.dp)) { Icon(Icons.Outlined.Upload, null); Text(" Enviar") }
                OutlinedButton(onClick = { newFolder = true }, enabled = !vm.working, shape = RoundedCornerShape(12.dp)) { Text("Nova pasta") }
                IconButton(onClick = vm::sync, enabled = !vm.working) { Icon(Icons.Outlined.Sync, "Sincronizar com Google Drive") }
            }
        }
        if (vm.resumable && vm.transfer == null && !trash) item {
            Card { Column(Modifier.fillMaxWidth().padding(16.dp)) {
                Text("Há um envio para retomar", fontWeight = FontWeight.SemiBold)
                Row { TextButton(onClick = vm::resumeUpload) { Text("Retomar") }; TextButton(onClick = vm::discardUpload) { Text("Descartar retomada") } }
            } }
        }
        items(visibleFolders, key = { "folder-${it.id}" }) { folder ->
            Surface(shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().clickable { vm.openFolder(folder) }) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Icon(Icons.Outlined.Folder, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
                    Text(folder.name, Modifier.weight(1f), fontWeight = FontWeight.Medium); Icon(Icons.Outlined.ChevronRight, "Abrir pasta")
                }
            }
        }
        if (visibleFiles.isEmpty() && visibleFolders.isEmpty() && !vm.loading) item {
            Surface(shape = RoundedCornerShape(18.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(if (trash) Icons.Outlined.DeleteOutline else Icons.Outlined.CloudQueue, null, Modifier.size(46.dp), tint = MaterialTheme.colorScheme.primary)
                    Text(if (vm.query.isNotBlank()) "Nenhum resultado" else "Seu espaço está livre", fontWeight = FontWeight.SemiBold, fontSize = 19.sp)
                    Text(if (trash) "Os arquivos removidos aparecem aqui." else "Conecte uma conta e envie seus primeiros arquivos.", fontSize = 13.sp)
                }
            }
        }
        items(visibleFiles.chunked(if (grid) 2 else 1), key = { it.first().id }) { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { file ->
                    FileCard(file, grid, trash, !vm.working && vm.transfer == null, Modifier.weight(1f), open, download,
                        rename = { rename = it }, move = { move = it }, trashAction = { deleting = it }, restore = vm::restore)
                }
                if (grid && row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
    if (newFolder) NameDialog("Nova pasta", "", { newFolder = false }) { vm.createFolder(it); newFolder = false }
    rename?.let { file -> NameDialog("Renomear arquivo", file.name, { rename = null }) { vm.rename(file, it); rename = null } }
    move?.let { file -> AlertDialog(onDismissRequest = { move = null }, title = { Text("Mover para") }, text = {
        LazyColumn(Modifier.heightIn(max = 320.dp)) {
            item { TextButton(onClick = { vm.move(file, null); move = null }) { Text("Meus arquivos (raiz)") } }
            items(vm.folders) { folder -> TextButton(onClick = { vm.move(file, folder.id); move = null }) { Text(folder.name) } }
        }
    }, confirmButton = {}, dismissButton = { TextButton(onClick = { move = null }) { Text("Cancelar") } }) }
    deleting?.let { file -> AlertDialog(onDismissRequest = { deleting = null }, title = { Text("Mover para a lixeira?") },
        text = { Text("${file.name} será movido para a lixeira do Google Drive. O arquivo poderá ser restaurado.") },
        confirmButton = { TextButton(onClick = { vm.trash(file); deleting = null }) { Text("Mover para lixeira") } },
        dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancelar") } }) }
}

@Composable private fun FileCard(file: DriveFile, grid: Boolean, trash: Boolean, enabled: Boolean, modifier: Modifier,
    open: (DriveFile) -> Unit, download: (DriveFile) -> Unit, rename: (DriveFile) -> Unit, move: (DriveFile) -> Unit, trashAction: (DriveFile) -> Unit, restore: (DriveFile) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val icon = when { file.mime.startsWith("image/") -> Icons.Outlined.Image; file.mime.startsWith("video/") -> Icons.Outlined.Movie
        file.mime == "application/pdf" -> Icons.Outlined.PictureAsPdf; else -> Icons.Outlined.InsertDriveFile }
    Surface(modifier, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .5f))) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(if (grid) 38.dp else 28.dp))
                if (!grid) Column(Modifier.weight(1f).padding(horizontal = 12.dp)) { FileLabel(file) }
                else Spacer(Modifier.weight(1f))
                Box {
                    IconButton(onClick = { menu = true }, enabled = enabled) { Icon(Icons.Outlined.MoreVert, "Ações de ${file.name}") }
                    DropdownMenu(menu, { menu = false }) {
                        if (trash) DropdownMenuItem(text = { Text("Restaurar") }, onClick = { menu = false; restore(file) })
                        else {
                            DropdownMenuItem(text = { Text("Abrir arquivo") }, onClick = { menu = false; open(file) })
                            DropdownMenuItem(text = { Text("Salvar no dispositivo") }, onClick = { menu = false; download(file) })
                            DropdownMenuItem(text = { Text("Renomear") }, onClick = { menu = false; rename(file) })
                            DropdownMenuItem(text = { Text("Mover") }, onClick = { menu = false; move(file) })
                            DropdownMenuItem(text = { Text("Mover para lixeira") }, onClick = { menu = false; trashAction(file) })
                        }
                    }
                }
            }
            if (grid) { Spacer(Modifier.height(12.dp)); FileLabel(file) }
        }
    }
}
@Composable private fun FileLabel(file: DriveFile) {
    Text(file.name, fontWeight = FontWeight.Medium, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
    Text(bytes(file.size), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
@Composable private fun NameDialog(title: String, initial: String, dismiss: () -> Unit, submit: (String) -> Unit) {
    var name by remember { mutableStateOf(initial) }
    AlertDialog(onDismissRequest = dismiss, title = { Text(title) }, text = {
        OutlinedTextField(name, { if (it.length <= 255) name = it }, label = { Text("Nome") }, singleLine = true)
    }, confirmButton = { TextButton(onClick = { submit(name.trim()) }, enabled = name.trim().isNotEmpty()) { Text("Salvar") } },
        dismissButton = { TextButton(onClick = dismiss) { Text("Cancelar") } })
}

@Composable private fun AccountsScreen(vm: DriveModel, settings: Boolean, connect: (Boolean) -> Unit) {
    var full by rememberSaveable { mutableStateOf(false) }; var disconnect by remember { mutableStateOf<DriveAccount?>(null) }
    var logout by remember { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { Text(if (settings) "Configurações" else "Seu espaço", fontSize = 28.sp, fontWeight = FontWeight.SemiBold) }
        item { StorageCard(vm) }
        if (settings) item {
            Card { Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(vm.user?.optString("name").orEmpty(), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                Text(vm.user?.optString("email").orEmpty(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            } }
        }
        item {
            Card { Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Conectar Google Drive", fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                Text("Escolha o acesso para a conta que vai conectar.", fontSize = 13.sp)
                Row(Modifier.fillMaxWidth().clickable { full = false }, verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(!full, { full = false }); Column { Text("Essencial", fontWeight = FontWeight.SemiBold); Text("Arquivos autorizados ao SingleDrive", fontSize = 12.sp) }
                }
                Row(Modifier.fillMaxWidth().clickable { full = true }, verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(full, { full = true }); Column { Text("Drive completo", fontWeight = FontWeight.SemiBold); Text("Todos os arquivos permitidos pela conta", fontSize = 12.sp) }
                }
                Text(if (full) "Permite acesso amplo ao Drive após seu consentimento no Google." else "Permite enviar, abrir, renomear, mover e apagar arquivos criados ou autorizados ao aplicativo.", fontSize = 12.sp, lineHeight = 18.sp)
                Button(onClick = { connect(full) }, enabled = !vm.working, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Add, null); Text(" Conectar conta") }
            } }
        }
        item { Text("Contas conectadas", fontWeight = FontWeight.SemiBold) }
        if (vm.accounts.isEmpty()) item { Text("Nenhuma conta conectada. Conecte seu Drive para começar.", fontSize = 13.sp) }
        items(vm.accounts, key = { it.id }) { a ->
            Card { Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.CloudQueue, null, tint = MaterialTheme.colorScheme.primary); Text(a.email, Modifier.padding(start = 10.dp).weight(1f), maxLines = 2) }
                Text("${bytes(a.used)} usados · ${bytes(a.total)}", fontSize = 12.sp)
                LinearProgressIndicator(progress = { a.total?.takeIf { it > 0 }?.let { (a.used.toFloat() / it).coerceIn(0f, 1f) } ?: 0f }, modifier = Modifier.fillMaxWidth())
                Text(if (a.full) "Acesso completo ao Drive" else "Acesso essencial ou provedor externo", fontSize = 11.sp)
                Row { TextButton(onClick = { vm.syncAccount(a) }, enabled = !vm.working) { Text("Atualizar espaço") }
                    if (settings) TextButton(onClick = { disconnect = a }, enabled = !vm.working) { Text("Desconectar") } }
            } }
        }
        if (settings) item { OutlinedButton(onClick = { logout = true }, enabled = !vm.working && vm.transfer == null, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.AutoMirrored.Outlined.Logout, null); Text(" Sair da conta")
        } }
        item { Text("SingleDrive para Android · ${BuildConfig.VERSION_NAME}", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    disconnect?.let { a -> AlertDialog(onDismissRequest = { disconnect = null }, title = { Text("Desconectar conta?") },
        text = { Text("O acesso do SingleDrive a ${a.email} será revogado. Os arquivos permanecem no seu provedor.") },
        confirmButton = { TextButton(onClick = { vm.disconnect(a); disconnect = null }) { Text("Desconectar") } },
        dismissButton = { TextButton(onClick = { disconnect = null }) { Text("Cancelar") } }) }
    if (logout) AlertDialog(onDismissRequest = { logout = false }, title = { Text("Sair do SingleDrive?") }, text = { Text("Será necessário entrar novamente neste dispositivo.") },
        confirmButton = { TextButton(onClick = { vm.logout(); logout = false }) { Text("Sair") } }, dismissButton = { TextButton(onClick = { logout = false }) { Text("Cancelar") } })
}
