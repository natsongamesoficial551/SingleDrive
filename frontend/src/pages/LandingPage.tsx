import { Cloud, Download, Folder, HardDrive, Monitor, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BrandLogo } from '@/components/drive/BrandLogo'

const installer = 'https://github.com/natsongamesoficial551/SingleDrive/releases/latest/download/SingleDrive-Windows-x64.msi'
const features = [
  { icon: Cloud, title: 'Contas reunidas', text: 'Conecte várias contas Google Drive e use o espaço delas em uma única unidade.' },
  { icon: Monitor, title: 'Arquivos no Explorador', text: 'Salve documentos, fotos e vídeos pelo Windows como faria em qualquer outra unidade.' },
  { icon: ShieldCheck, title: 'Acesso sob seu controle', text: 'Gerencie os PCs no site e pause ou revogue um vínculo quando precisar.' },
]

export function LandingPage() {
  return <div className="min-h-dvh bg-[#f6f8f5] text-[#122d2a]">
    <header className="border-b border-[#dbe6e0]">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8" aria-label="Navegação principal">
        <Link to="/" className="flex items-center gap-2.5 text-lg font-extrabold"><BrandLogo />SingleDrive</Link>
        <Link to="/login" className="rounded-xl border border-[#b7ccc1] px-4 py-2 text-sm font-bold hover:bg-[#e4eee8]">Entrar</Link>
      </nav>
    </header>
    <main className="mx-auto max-w-6xl px-5 pb-12 pt-9 sm:px-8 sm:pt-12">
      <section className="grid items-center gap-9 overflow-hidden rounded-[1.75rem] bg-[#092f2c] px-6 py-10 text-[#eef9f2] shadow-xl shadow-[#0a332213] sm:px-11 sm:py-14 lg:grid-cols-[1.12fr_0.88fr] lg:gap-12">
        <div>
          <h1 className="max-w-xl text-4xl font-extrabold leading-[1.04] tracking-[-0.05em] sm:text-6xl">Suas contas Google Drive, em uma unidade.</h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-[#b9d9ca] sm:text-lg">Reúna seu espaço na nuvem para salvar, abrir e organizar arquivos direto no Explorador do Windows.</p>
          <a href={installer} className="mt-7 inline-flex min-h-12 items-center justify-center gap-2.5 rounded-xl bg-[#bdf3cd] px-5 font-extrabold text-[#12352b] hover:bg-[#d5f9df]">
            <Download className="h-5 w-5" aria-hidden="true" /> Baixar para Windows
          </a>
          <p className="mt-3 text-sm text-[#b9d9ca]">Instalador MSI · Windows 64 bits</p>
        </div>
        <div className="rounded-2xl border border-[#659b8566] bg-[#143e37] p-4 sm:p-6" aria-label="Exemplo da unidade SingleDrive no Windows">
          <div className="flex items-center gap-3 rounded-xl bg-[#e6f4e9] p-4 text-[#173d32]">
            <div className="rounded-lg bg-[#cae6d5] p-2.5"><HardDrive className="h-6 w-6" aria-hidden="true" /></div>
            <div><p className="font-extrabold">SingleDrive (S:)</p><p className="text-sm text-[#416456]">Este Computador · Windows</p></div>
          </div>
          <ul className="mt-3 divide-y divide-[#456b5d] px-2 text-sm text-[#d3e8dc]">
            {['Documentos', 'Fotos', 'Projetos'].map(folder => <li key={folder} className="flex items-center gap-3 py-3"><Folder className="h-4 w-4 text-[#a7dbb9]" aria-hidden="true" />{folder}</li>)}
          </ul>
        </div>
      </section>
      <section className="mt-9 grid gap-4 md:grid-cols-3" aria-label="Recursos do SingleDrive">
        {features.map(({ icon: Icon, title, text }) => <article key={title} className="rounded-2xl border border-[#dbe6e0] bg-white p-5 sm:p-6">
          <Icon className="mb-4 h-6 w-6 text-[#08725f]" aria-hidden="true" />
          <h2 className="text-lg font-extrabold">{title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#475f54]">{text}</p>
        </article>)}
      </section>
      <section className="mt-9 grid gap-3 border-t border-[#dbe6e0] pt-7 sm:grid-cols-[14rem_1fr] sm:gap-6">
        <h2 className="text-xl font-extrabold">Como começar</h2>
        <p className="text-sm leading-relaxed text-[#475f54]">Instale o SingleDrive, entre com Google e conecte suas contas do Drive em Configurações. No aplicativo Windows, clique em <strong>Criar disco remoto</strong> para abrir a unidade no Explorador.</p>
      </section>
    </main>
  </div>
}
