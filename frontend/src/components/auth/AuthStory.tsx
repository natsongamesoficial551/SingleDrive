import { Cloud, FileText, Image, Folder, ArrowUpRight } from 'lucide-react'
import { BrandLogo } from '@/components/drive/BrandLogo'
export function AuthStory() {
 return <section className="sd-auth-story">
 <div className="flex items-center gap-3"><BrandLogo /><span className="sd-wordmark">SingleDrive</span></div>
 <div className="sd-auth-copy"><span className="sd-eyebrow">MENOS DISTÂNCIA. MAIS ESPAÇO.</span><h1>Uma nova casa<br />para suas nuvens.</h1><p>Conecte suas contas Google Drive e encontre seus arquivos em um único lugar. Simples, organizado e seu.</p></div>
 <div className="sd-cloud-art" aria-hidden="true"><div className="sd-orbit" /><div className="sd-art-file"><FileText />Documentos</div><div className="sd-art-center"><Cloud size={48} /><span>SingleDrive</span></div><div className="sd-art-photo"><Image />Memórias</div><div className="sd-art-folder"><Folder />Projetos<ArrowUpRight size={16} /></div></div>
 <p className="sd-auth-footnote">Múltiplas contas. Uma experiência.</p></section>
}
