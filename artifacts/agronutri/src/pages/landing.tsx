import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Bot,
  Calculator,
  TestTube,
  SprayCan,
  FileText,
  Smartphone,
  ShieldCheck,
  Droplets,
  Leaf,
  LineChart,
  Users,
  CheckCircle2,
  ArrowRight,
  Fingerprint,
  FlaskConical,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;
const img = (name: string) => `${BASE}landing/${name}`;

function BrowserFrame({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`rounded-xl overflow-hidden shadow-2xl ring-1 ring-black/10 bg-white ${className}`}>
      <div className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 border-b border-gray-200">
        <span className="w-3 h-3 rounded-full bg-red-400" />
        <span className="w-3 h-3 rounded-full bg-yellow-400" />
        <span className="w-3 h-3 rounded-full bg-green-400" />
        <div className="ml-3 flex-1 max-w-xs h-5 rounded bg-white border border-gray-200" />
      </div>
      <img src={src} alt={alt} loading="lazy" className="w-full block" />
    </div>
  );
}

function PhoneFrame({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`rounded-[2.2rem] border-[10px] border-gray-900 bg-gray-900 shadow-2xl overflow-hidden ${className}`}>
      <img src={src} alt={alt} loading="lazy" className="w-full block rounded-[1.6rem]" />
    </div>
  );
}

const features = [
  {
    icon: TestTube,
    title: "Analíticas centralizadas",
    text: "Suelo, foliar y agua en un solo lugar, por finca o por sector. Sube el PDF del laboratorio y la IA extrae los parámetros por ti.",
  },
  {
    icon: Calculator,
    title: "Calculadora de fertirrigación",
    text: "Plan de abonado semanal con estimación de CE, nutrientes aportados y avisos de incompatibilidad entre productos.",
  },
  {
    icon: Bot,
    title: "Técnico virtual con IA",
    text: "Programas de abonado generados a partir de tus analíticas y un chat agronómico que conoce tu finca, con fotos y documentos.",
  },
  {
    icon: Droplets,
    title: "Acidificación del agua",
    text: "Si usas ácido para bajar el pH de riego, la IA calcula los litros semanales necesarios a partir del pH y los bicarbonatos.",
  },
  {
    icon: SprayCan,
    title: "Sanidad vegetal",
    text: "Catálogo de fitosanitarios con registro, materia activa y plazos de seguridad. Registra cada aplicación por sector.",
  },
  {
    icon: FileText,
    title: "Informes profesionales",
    text: "Informes técnicos en PDF y Word con tus datos, analíticas y programa, con resumen redactado por IA y tu logo.",
  },
  {
    icon: Users,
    title: "Equipo y roles",
    text: "Propietarios, técnicos y colaboradores con permisos por finca, auditoría de acciones y gestión de usuarios.",
  },
  {
    icon: ShieldCheck,
    title: "Tus datos, en tu servidor",
    text: "Instálalo en tu propia infraestructura con un solo comando: HTTPS automático, copias de seguridad y actualizaciones sencillas.",
  },
];

const steps = [
  { n: "1", title: "Sube tus analíticas", text: "Agua, suelo y foliar: a mano o importando el PDF del laboratorio con IA." },
  { n: "2", title: "Genera tu programa", text: "El técnico virtual propone un plan de abonado semanal adaptado a tu finca o sector." },
  { n: "3", title: "Aplica y controla", text: "Valida el programa, registra fitosanitarios y entrega informes profesionales." },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Nav */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <img src={`${BASE}logo.png`} alt="AgroNutri AI" className="h-9" />
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" data-testid="button-landing-login">Entrar</Button>
            </Link>
            <Link href="/login">
              <Button className="bg-green-700 hover:bg-green-800" data-testid="button-landing-cta-top">
                Empezar ahora <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-green-50 via-white to-white" />
        <div className="relative max-w-6xl mx-auto px-4 pt-16 pb-8 text-center">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-green-800 bg-green-100 rounded-full px-4 py-1.5 mb-6">
            <Leaf className="w-4 h-4" /> Fertirrigación inteligente para platanera
          </span>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-tight">
            Tu técnico virtual,
            <br />
            <span className="text-green-700">a pie de finca</span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-gray-600 max-w-2xl mx-auto">
            AgroNutri AI convierte tus analíticas de suelo, foliar y agua en programas de abonado
            precisos, con inteligencia artificial, calculadora de fertirrigación e informes
            profesionales. Desde el ordenador o desde el móvil, en plena finca.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/login">
              <Button size="lg" className="bg-green-700 hover:bg-green-800 text-base h-12 px-8" data-testid="button-landing-cta-hero">
                Probar AgroNutri AI <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <a href="#funciones">
              <Button size="lg" variant="outline" className="text-base h-12 px-8">
                Ver funcionalidades
              </Button>
            </a>
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-600" /> Instalación en tu propio servidor</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-600" /> Web + app móvil</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-600" /> IA con tu propia clave</span>
          </div>
        </div>

        {/* Hero visual */}
        <div className="relative max-w-6xl mx-auto px-4 pb-20">
          <div className="relative">
            <BrowserFrame src={img("web-finca.png")} alt="Panel de finca de AgroNutri AI" className="md:mx-8" />
            <PhoneFrame
              src={img("movil-finca.png")}
              alt="Ficha de finca en la app móvil"
              className="hidden md:block absolute -bottom-10 -right-2 w-52 rotate-3"
            />
          </div>
        </div>
      </section>

      {/* Value strip */}
      <section className="bg-green-900 text-green-50">
        <div className="max-w-6xl mx-auto px-4 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            ["Analíticas", "suelo · foliar · agua"],
            ["Programas IA", "por finca o por sector"],
            ["Fitosanitarios", "plazos y aplicaciones"],
            ["Informes", "PDF y Word con tu logo"],
          ].map(([t, s]) => (
            <div key={t}>
              <div className="text-xl font-bold">{t}</div>
              <div className="text-sm text-green-200 mt-1">{s}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <h2 className="text-3xl md:text-4xl font-bold text-center">Del laboratorio al goteo en tres pasos</h2>
        <div className="mt-12 grid md:grid-cols-3 gap-8">
          {steps.map((s) => (
            <div key={s.n} className="relative rounded-2xl border border-gray-100 bg-gray-50 p-8">
              <div className="w-10 h-10 rounded-full bg-green-700 text-white flex items-center justify-center font-bold text-lg">{s.n}</div>
              <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
              <p className="mt-2 text-gray-600">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Screenshot: dashboard */}
      <section className="bg-gray-50 border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-20 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <span className="inline-flex items-center gap-2 text-sm font-medium text-green-800"><LineChart className="w-4 h-4" /> Visión global</span>
            <h2 className="mt-3 text-3xl font-bold">Toda tu explotación de un vistazo</h2>
            <p className="mt-4 text-gray-600 text-lg">
              Fincas, plantas en producción, recomendaciones pendientes, coste de IA del mes,
              actividad reciente y alertas agronómicas: renueva analíticas a tiempo y vigila el
              sodio, la CE o los plazos de seguridad sin hojas de cálculo.
            </p>
            <ul className="mt-6 space-y-2 text-gray-700">
              {["Alertas automáticas por finca", "Actividad y auditoría del equipo", "Control del gasto en IA"].map((t) => (
                <li key={t} className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" /> {t}</li>
              ))}
            </ul>
          </div>
          <BrowserFrame src={img("web-dashboard.png")} alt="Dashboard general" />
        </div>
      </section>

      {/* Screenshot: analiticas */}
      <section className="max-w-6xl mx-auto px-4 py-20 grid md:grid-cols-2 gap-12 items-center">
        <BrowserFrame src={img("web-analiticas.png")} alt="Analíticas de la finca" className="order-last md:order-first" />
        <div>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-green-800"><FlaskConical className="w-4 h-4" /> Analíticas</span>
          <h2 className="mt-3 text-3xl font-bold">Tus analíticas trabajan por ti</h2>
          <p className="mt-4 text-gray-600 text-lg">
            Registra analíticas de suelo, foliar y agua por finca o por sector, o importa
            directamente el PDF del laboratorio: la IA extrae los parámetros y los deja listos
            para el cálculo.
          </p>
          <ul className="mt-6 space-y-2 text-gray-700">
            {["Importación de PDF con IA", "Ámbito global o por sector", "Histórico completo por tipo"].map((t) => (
              <li key={t} className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" /> {t}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Screenshot: calculadora */}
      <section className="bg-gray-50 border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-20 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <span className="inline-flex items-center gap-2 text-sm font-medium text-green-800"><Bot className="w-4 h-4" /> IA agronómica</span>
            <h2 className="mt-3 text-3xl font-bold">Programas de abonado con inteligencia artificial</h2>
            <p className="mt-4 text-gray-600 text-lg">
              Pulsa «Generar con IA» y obtén un borrador de programa semanal basado en tus últimas
              analíticas, tu catálogo de fertilizantes y las condiciones de tu finca. Ajusta,
              valida y aplícalo con seguimiento de estados.
            </p>
            <ul className="mt-6 space-y-2 text-gray-700">
              {[
                "Por finca completa o sector a sector",
                "Cálculo de litros de ácido para corregir el pH del agua",
                "CE estimada y avisos de incompatibilidad",
                "Chat con el técnico virtual, con fotos y adjuntos",
              ].map((t) => (
                <li key={t} className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" /> {t}</li>
              ))}
            </ul>
          </div>
          <BrowserFrame src={img("web-calculadora.png")} alt="Calculadora de fertirrigación con IA" />
        </div>
      </section>

      {/* Screenshot: fitosanitarios */}
      <section className="max-w-6xl mx-auto px-4 py-20 grid md:grid-cols-2 gap-12 items-center">
        <BrowserFrame src={img("web-fitosanitarios.png")} alt="Catálogo de fitosanitarios" className="order-last md:order-first" />
        <div>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-green-800"><SprayCan className="w-4 h-4" /> Sanidad vegetal</span>
          <h2 className="mt-3 text-3xl font-bold">Fitosanitarios bajo control</h2>
          <p className="mt-4 text-gray-600 text-lg">
            Catálogo con número de registro, materia activa, plaga objetivo y plazos de seguridad,
            con fichas actualizables por IA. Registra cada aplicación por sector y recibe avisos
            de productos con registro caducado.
          </p>
          <ul className="mt-6 space-y-2 text-gray-700">
            {["Fichas actualizadas con IA", "Registro de aplicaciones por sector", "Avisos de caducidad de registro"].map((t) => (
              <li key={t} className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" /> {t}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Mobile app */}
      <section className="bg-green-900 text-white overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 py-20 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <span className="inline-flex items-center gap-2 text-sm font-medium text-green-200"><Smartphone className="w-4 h-4" /> App móvil</span>
            <h2 className="mt-3 text-3xl md:text-4xl font-bold">La finca, en tu bolsillo</h2>
            <p className="mt-4 text-green-100 text-lg">
              Consulta tus fincas, el programa vigente y las alertas desde el móvil, chatea con el
              técnico virtual delante de la planta y protege el acceso con tu huella o Face ID.
              Además, la web se instala como aplicación (PWA) en cualquier dispositivo.
            </p>
            <ul className="mt-6 space-y-2 text-green-50">
              {[
                ["Bloqueo biométrico opcional", Fingerprint],
                ["Misma cuenta que en la web", Users],
                ["Alertas y programa siempre a mano", Leaf],
              ].map(([t, Icon]: any) => (
                <li key={t} className="flex items-center gap-2"><Icon className="w-5 h-5 text-green-300 shrink-0" /> {t}</li>
              ))}
            </ul>
          </div>
          <div className="flex justify-center gap-4 md:gap-6">
            <PhoneFrame src={img("movil-login.png")} alt="Acceso a la app móvil" className="w-40 md:w-52 -rotate-3 mt-8" />
            <PhoneFrame src={img("movil-home.png")} alt="Mis fincas en el móvil" className="w-40 md:w-52 rotate-2" />
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section id="funciones" className="max-w-6xl mx-auto px-4 py-20">
        <h2 className="text-3xl md:text-4xl font-bold text-center">Todo lo que necesita tu explotación</h2>
        <p className="mt-4 text-center text-gray-600 max-w-2xl mx-auto text-lg">
          Una sola plataforma para la nutrición, la sanidad y la documentación técnica de tus fincas.
        </p>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-gray-100 p-6 hover:shadow-lg hover:border-green-200 transition-shadow bg-white">
              <div className="w-11 h-11 rounded-xl bg-green-100 text-green-700 flex items-center justify-center">
                <f.icon className="w-5 h-5" />
              </div>
              <h3 className="mt-4 font-semibold text-lg">{f.title}</h3>
              <p className="mt-2 text-sm text-gray-600 leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="precios" className="bg-gray-50 border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-20">
          <h2 className="text-3xl md:text-4xl font-bold text-center">Un precio simple, pensado para cooperativas</h2>
          <p className="mt-4 text-center text-gray-600 max-w-2xl mx-auto text-lg">
            Cada cooperativa u OPP dispone de su propia instalación independiente, con sus datos en
            su propio servidor.
          </p>
          <div className="mt-12 max-w-3xl mx-auto rounded-3xl bg-white border border-green-200 shadow-xl overflow-hidden">
            <div className="bg-green-700 text-white px-8 py-5 text-center">
              <span className="font-semibold tracking-wide uppercase text-sm">Plan cooperativa / OPP</span>
            </div>
            <div className="px-8 py-10 grid sm:grid-cols-2 gap-8 items-center">
              <div className="text-center sm:border-r sm:border-gray-100">
                <div className="text-5xl font-extrabold text-gray-900">100 €<span className="text-lg font-medium text-gray-500">/mes</span></div>
                <p className="mt-2 text-gray-600">Instalación y mantenimiento: servidor dedicado, dominio, copias de seguridad, actualizaciones y soporte.</p>
              </div>
              <div className="text-center">
                <div className="text-5xl font-extrabold text-gray-900">2,50 €<span className="text-lg font-medium text-gray-500">/finca/mes</span></div>
                <p className="mt-2 text-gray-600">Por cada finca activa, sin límite de sectores, analíticas ni usuarios técnicos.</p>
              </div>
            </div>
            <div className="px-8 pb-8">
              <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-gray-700">
                {[
                  "Instalación independiente para cada cooperativa",
                  "Web + app móvil incluidas",
                  "Usuarios y técnicos ilimitados",
                  "Copias de seguridad diarias",
                  "Actualizaciones y mejoras continuas",
                  "Consumo de OpenAI aparte, con la clave de la cooperativa y límite de gasto configurable",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2 text-sm"><CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" /> {t}</li>
                ))}
              </ul>
              <div className="mt-8 text-center">
                <Link href="/login">
                  <Button size="lg" className="bg-green-700 hover:bg-green-800 h-12 px-8" data-testid="button-landing-cta-pricing">
                    Solicitar instalación <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
              <p className="mt-6 text-xs text-gray-500 text-center leading-relaxed">
                Precios sin impuestos. Revisión de precios como máximo una vez al año, comunicada con
                60 días de antelación y limitada a IPC + 2 puntos, con derecho a resolver el contrato
                sin penalización si no se acepta. Consulta los{" "}
                <Link href="/terminos" className="text-green-700 underline">términos y condiciones</Link>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-4xl mx-auto px-4 pb-24">
        <div className="rounded-3xl bg-gradient-to-br from-green-700 to-green-900 text-white px-8 py-14 text-center shadow-xl">
          <h2 className="text-3xl md:text-4xl font-bold">Empieza a abonar con datos, no con intuición</h2>
          <p className="mt-4 text-green-100 text-lg max-w-xl mx-auto">
            Instala AgroNutri AI en tu servidor en minutos y ten a tu técnico virtual trabajando hoy mismo.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/login">
              <Button size="lg" className="bg-white text-green-800 hover:bg-green-50 text-base h-12 px-8" data-testid="button-landing-cta-bottom">
                Entrar en la plataforma <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <img src={`${BASE}logo.png`} alt="AgroNutri AI" className="h-8" />
          <p className="text-sm text-gray-500">
            AgroNutri AI — Fertirrigación y sanidad vegetal para platanera. © {new Date().getFullYear()}
          </p>
          <div className="flex items-center gap-5">
            <a href="#precios" className="text-sm font-medium text-green-700 hover:underline">Precios</a>
            <Link href="/terminos" className="text-sm font-medium text-green-700 hover:underline">
              Términos y condiciones
            </Link>
            <Link href="/login" className="text-sm font-medium text-green-700 hover:underline">
              Acceder
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
