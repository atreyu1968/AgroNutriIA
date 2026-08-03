import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-gray-900">
        {n}. {title}
      </h2>
      <div className="mt-3 space-y-3 text-gray-700 leading-relaxed">{children}</div>
    </section>
  );
}

export default function Terminos() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/landing">
            <img src={`${BASE}logo.png`} alt="AgroNutri AI" className="h-9 cursor-pointer" />
          </Link>
          <Link href="/landing">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" /> Volver
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl md:text-4xl font-bold">Términos y condiciones del servicio</h1>
        <p className="mt-3 text-gray-500">Última actualización: agosto de 2026</p>

        <Section n={1} title="Objeto del servicio">
          <p>
            AgroNutri AI es una plataforma de gestión de fertirrigación y sanidad vegetal dirigida a
            cooperativas y organizaciones de productores (OPP). El servicio comprende la instalación
            de la plataforma en una infraestructura dedicada para cada entidad contratante, su
            mantenimiento técnico, las actualizaciones de software y el soporte descrito en estos
            términos.
          </p>
          <p>
            La plataforma es una herramienta de apoyo a la decisión para los técnicos de la entidad.
            Las recomendaciones generadas —incluidas las elaboradas mediante inteligencia
            artificial— tienen carácter orientativo y deben ser revisadas y validadas por un técnico
            cualificado antes de su aplicación en campo.
          </p>
        </Section>

        <Section n={2} title="Precio">
          <p>El precio del servicio se compone de:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Cuota base: 100 € al mes</strong> por instalación, que incluye el servidor
              dedicado, el dominio o subdominio, las copias de seguridad, las actualizaciones de la
              plataforma y el mantenimiento técnico.
            </li>
            <li>
              <strong>Cuota por finca: 2,50 € al mes</strong> por cada finca activa dada de alta en
              la plataforma. Se considera finca activa aquella con actividad registrada durante el
              mes facturado (analíticas, programas de abonado o aplicaciones fitosanitarias).
            </li>
          </ul>
          <p>
            Los precios se expresan sin impuestos indirectos, que se añadirán según la legislación
            vigente. La puesta en marcha inicial (instalación, carga de catálogos y formación) podrá
            facturarse como concepto único e independiente, según se acuerde en el contrato.
          </p>
        </Section>

        <Section n={3} title="Costes de inteligencia artificial">
          <p>
            Las funciones de inteligencia artificial (técnico virtual, borradores de programas,
            importación de analíticas en PDF, informes con resumen automático) operan con la clave
            de API de OpenAI de la propia entidad contratante, que asume directamente su coste
            frente a OpenAI.
          </p>
          <p>
            La plataforma incluye un panel de consumo y la posibilidad de fijar un límite mensual de
            gasto. El prestador no percibe cantidad alguna por el consumo de la API de OpenAI ni es
            responsable de los cambios de precios o condiciones de dicho proveedor.
          </p>
        </Section>

        <Section n={4} title="Cláusula de revisión de precios">
          <p>
            Los precios podrán revisarse <strong>una vez por año natural</strong>. Cualquier
            revisión será comunicada por escrito con al menos <strong>60 días de antelación</strong>{" "}
            a su entrada en vigor. Si la entidad no acepta la revisión, podrá resolver el contrato
            sin penalización antes de la fecha de aplicación del nuevo precio, manteniéndose las
            condiciones anteriores hasta la finalización del período ya facturado.
          </p>
          <p>
            Como referencia, las revisiones ordinarias no superarán la variación interanual del IPC
            general más dos puntos porcentuales. Quedan fuera de esta limitación los cambios de
            alcance del servicio pactados expresamente entre las partes (nuevas funcionalidades
            premium, ampliaciones de infraestructura u otros servicios adicionales).
          </p>
        </Section>

        <Section n={5} title="Facturación y pago">
          <p>
            La facturación es mensual, por adelantado en la cuota base y por recuento de fincas
            activas del mes anterior en la cuota variable. El pago se realizará mediante el método
            acordado en el contrato (domiciliación, transferencia o pasarela de pago online).
          </p>
          <p>
            El impago de dos mensualidades consecutivas facultará al prestador, previo aviso con 15
            días, para suspender temporalmente el acceso al servicio hasta la regularización, sin
            perjuicio de la conservación de los datos conforme a la cláusula 8.
          </p>
        </Section>

        <Section n={6} title="Nivel de servicio y soporte">
          <ul className="list-disc pl-6 space-y-1">
            <li>Objetivo de disponibilidad de la plataforma: 99 % mensual, excluidas las ventanas de mantenimiento programado comunicadas con antelación.</li>
            <li>Soporte por email en días laborables, con respuesta en un máximo de 48 horas laborables.</li>
            <li>Copias de seguridad diarias de la base de datos, con retención mínima de 14 días.</li>
            <li>Las actualizaciones de la plataforma se aplican de forma periódica e incluyen mejoras y correcciones sin coste adicional.</li>
          </ul>
        </Section>

        <Section n={7} title="Obligaciones de la entidad contratante">
          <ul className="list-disc pl-6 space-y-1">
            <li>Usar la plataforma conforme a la ley y a estos términos, y custodiar las credenciales de acceso de sus usuarios.</li>
            <li>Garantizar la veracidad de los datos introducidos (analíticas, fincas, aplicaciones fitosanitarias).</li>
            <li>Contar con técnicos cualificados que validen las recomendaciones antes de su aplicación.</li>
            <li>Disponer de su propia clave de API de OpenAI para las funciones de IA, si desea utilizarlas.</li>
            <li>Cumplir la normativa fitosanitaria aplicable; la plataforma es una herramienta de registro y apoyo, no sustituye las obligaciones legales de la entidad.</li>
          </ul>
        </Section>

        <Section n={8} title="Datos, confidencialidad y protección de datos">
          <p>
            Los datos introducidos en la plataforma pertenecen a la entidad contratante. Cada
            cooperativa dispone de una instalación independiente: sus datos no se comparten con
            otras entidades ni se utilizan para fines distintos de la prestación del servicio.
          </p>
          <p>
            El prestador actúa como encargado del tratamiento respecto de los datos personales
            alojados (usuarios, contactos de fincas), conforme al RGPD y a la LOPDGDD. Se suscribirá
            el correspondiente acuerdo de encargo de tratamiento. A la finalización del contrato, la
            entidad podrá solicitar una exportación completa de su base de datos; transcurridos 30
            días desde la finalización, los datos serán eliminados de forma segura.
          </p>
        </Section>

        <Section n={9} title="Propiedad intelectual">
          <p>
            El software AgroNutri AI, su código, diseño y documentación son propiedad del
            prestador. La entidad contratante recibe un derecho de uso no exclusivo e
            intransferible durante la vigencia del contrato, limitado a su propia actividad y a la
            de sus socios y técnicos.
          </p>
        </Section>

        <Section n={10} title="Responsabilidad">
          <p>
            El prestador responde de la correcta prestación del servicio con la diligencia
            profesional exigible. En ningún caso será responsable de decisiones agronómicas
            adoptadas sin la validación técnica exigida en la cláusula 7, ni de daños derivados de
            datos erróneos introducidos por la entidad, de fallos de proveedores externos (OpenAI,
            proveedores de infraestructura) o de causas de fuerza mayor.
          </p>
          <p>
            La responsabilidad total acumulada del prestador quedará limitada al importe abonado
            por la entidad durante los 12 meses anteriores al hecho que la origine.
          </p>
        </Section>

        <Section n={11} title="Duración y resolución">
          <p>
            El contrato tiene duración mensual con renovación automática. Cualquiera de las partes
            podrá resolverlo con un preaviso de 30 días, sin penalización. La resolución no da
            derecho al reembolso de períodos ya facturados, salvo lo previsto en la cláusula 4 para
            revisiones de precio no aceptadas.
          </p>
        </Section>

        <Section n={12} title="Legislación aplicable y jurisdicción">
          <p>
            Estos términos se rigen por la legislación española. Para cualquier controversia, las
            partes se someten a los juzgados y tribunales del domicilio del prestador, salvo norma
            imperativa en contrario.
          </p>
        </Section>

        <div className="mt-14 rounded-2xl bg-gray-50 border border-gray-100 p-6 text-sm text-gray-600">
          Este documento es una versión general de los términos del servicio. Las condiciones
          particulares de cada cooperativa u OPP (número de fincas, puesta en marcha, método de
          pago) se recogen en su contrato u oferta comercial.
        </div>
      </main>

      <footer className="border-t border-gray-100">
        <div className="max-w-3xl mx-auto px-4 py-8 flex items-center justify-between">
          <img src={`${BASE}logo.png`} alt="AgroNutri AI" className="h-7" />
          <Link href="/landing" className="text-sm font-medium text-green-700 hover:underline">
            Volver a la página principal
          </Link>
        </div>
      </footer>
    </div>
  );
}
