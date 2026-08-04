/**
 * Seed AgroNutri AI with the AGROSABINA SL reference data (Bajo Cuadras farm).
 * Run: npx tsx artifacts/api-server/src/seed.ts
 * Idempotent: skips if the demo user already exists.
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  farmsTable,
  sectorsTable,
  analysesTable,
  waterSourcesTable,
  fertilizersTable,
  recommendationsTable,
} from "@workspace/db";

async function main() {
  const email = "demo@agronutri.es";
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    console.log("Seed already applied, skipping.");
    return;
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: await bcrypt.hash("agronutri2026", 10),
      name: "Francisco Javier Pérez",
      company: "AGROSABINA SL",
      role: "owner",
      isAdmin: true,
      reportLanguage: "es",
    })
    .returning();

  const [farm] = await db
    .insert(farmsTable)
    .values({
      ownerId: user.id,
      name: "Bajo Cuadras",
      companyName: "AGROSABINA SL",
      island: "Tenerife",
      municipality: "Buenavista del Norte",
      mainCrop: "platanera",
      variety: "Pequeña enana",
      plantCount: 5500,
      surfaceHa: 2.75,
      phenologicalStage: "pre-parición",
      cropSystem: "aire libre",
      soilType: "franco-arcillo-arenoso",
      weeklyLitresPerPlant: 125,
      maxEcDsM: 2.2,
      managementNotes:
        "Mezcla de riego: 70 % agua de Balten (TFN) + 30 % agua desalada. Suelo con sodio de cambio elevado (17 % de la CIC).",
      responsibleTechnician: "Técnico de AGROSABINA SL",
    })
    .returning();

  await db.insert(waterSourcesTable).values([
    { farmId: farm.id, name: "Balten (TFN)", sharePct: 70 },
    { farmId: farm.id, name: "Desaladora", sharePct: 30 },
  ]);

  await db.insert(sectorsTable).values([
    { farmId: farm.id, name: "Sector Norte", plantCount: 2100, phenologicalStage: "pre-parición" },
    { farmId: farm.id, name: "Sector Central", plantCount: 1800, phenologicalStage: "pre-parición" },
    { farmId: farm.id, name: "Sector Sur", plantCount: 1600, phenologicalStage: "parición" },
  ]);

  await db.insert(analysesTable).values([
    {
      farmId: farm.id,
      type: "water",
      reference: "A-25/118011",
      laboratory: "Laboratorio agroalimentario (Balten TFN)",
      description: "Agua de riego Balten, toma TFN",
      sampleDate: "2025-07-28",
      createdBy: user.id,
      notes: "Agua alcalina con sodio elevado; se mezcla con 30 % de agua desalada.",
      parameters: [
        { name: "Conductividad eléctrica (CE)", value: 910, unit: "µS/cm", refLow: 0, refHigh: 1500, status: "normal" },
        { name: "pH", value: 8.6, unit: "", refLow: 6.5, refHigh: 8.4, status: "alto" },
        { name: "Alcalinidad total (CaCO3)", value: 380, unit: "mg/L", refLow: 0, refHigh: 200, status: "muy_alto" },
        { name: "Sodio (Na)", value: 170, unit: "mg/L", refLow: 0, refHigh: 115, status: "alto" },
        { name: "Calcio (Ca)", value: 9.55, unit: "mg/L", refLow: 40, refHigh: 120, status: "muy_bajo" },
        { name: "Magnesio (Mg)", value: 20.6, unit: "mg/L", refLow: 10, refHigh: 50, status: "normal" },
        { name: "Potasio (K)", value: 19.0, unit: "mg/L", refLow: 0, refHigh: 20, status: "normal" },
        { name: "Cloruros (Cl)", value: 101, unit: "mg/L", refLow: 0, refHigh: 150, status: "normal" },
        { name: "Boro (B)", value: 0.83, unit: "mg/L", refLow: 0, refHigh: 0.5, status: "alto" },
      ],
    },
    {
      farmId: farm.id,
      type: "leaf",
      reference: "V-25/061489",
      laboratory: "Laboratorio agroalimentario",
      description: "Muestra foliar, tercera hoja",
      sampleDate: "2025-09-25",
      createdBy: user.id,
      notes: "Deficiencia de Ca inducida por antagonismo Na/Mg/K; Fe y Zn bajos, Mn muy alto.",
      parameters: [
        { name: "Nitrógeno (N)", value: 2.68, unit: "%", refLow: 2.6, refHigh: 3.5, status: "normal" },
        { name: "Fósforo (P)", value: 0.203, unit: "%", refLow: 0.16, refHigh: 0.27, status: "normal" },
        { name: "Potasio (K)", value: 4.11, unit: "%", refLow: 3.0, refHigh: 4.0, status: "alto" },
        { name: "Calcio (Ca)", value: 0.88, unit: "%", refLow: 1.0, refHigh: 1.5, status: "bajo" },
        { name: "Magnesio (Mg)", value: 0.617, unit: "%", refLow: 0.3, refHigh: 0.6, status: "alto" },
        { name: "Azufre (S)", value: 0.17, unit: "%", refLow: 0.2, refHigh: 0.3, status: "bajo" },
        { name: "Hierro (Fe)", value: 94.1, unit: "mg/kg", refLow: 100, refHigh: 300, status: "bajo" },
        { name: "Manganeso (Mn)", value: 358, unit: "mg/kg", refLow: 50, refHigh: 200, status: "muy_alto" },
        { name: "Zinc (Zn)", value: 16, unit: "mg/kg", refLow: 20, refHigh: 50, status: "bajo" },
        { name: "Boro (B)", value: 21.4, unit: "mg/kg", refLow: 15, refHigh: 50, status: "normal" },
        { name: "Cloruros (Cl)", value: 9566, unit: "mg/kg", refLow: 0, refHigh: 12000, status: "normal" },
        { name: "Sodio (Na)", value: 457, unit: "mg/kg", refLow: 0, refHigh: 1000, status: "normal" },
      ],
    },
    {
      farmId: farm.id,
      type: "soil",
      reference: "S-25/079328",
      laboratory: "Laboratorio agroalimentario",
      description: "Suelo 0-30 cm, zona representativa",
      sampleDate: "2025-09-25",
      createdBy: user.id,
      notes: "Sodio de cambio 17,1 % de la CIC: principal problema. pH muy alcalino.",
      parameters: [
        { name: "pH", value: 8.72, unit: "", refLow: 6.0, refHigh: 7.5, status: "muy_alto" },
        { name: "CE (extracto 1:5)", value: 750, unit: "µS/cm", refLow: 0, refHigh: 800, status: "alto" },
        { name: "Materia orgánica", value: 6.73, unit: "%", refLow: 2, refHigh: 6, status: "alto" },
        { name: "Nitrógeno total", value: 3755, unit: "mg/kg", refLow: 1000, refHigh: 3000, status: "alto" },
        { name: "Fósforo Olsen", value: 216, unit: "mg/kg", refLow: 25, refHigh: 60, status: "muy_alto" },
        { name: "Calcio de cambio", value: 21.9, unit: "meq/100g", refLow: 8, refHigh: 25, status: "normal" },
        { name: "Magnesio de cambio", value: 14.2, unit: "meq/100g", refLow: 2, refHigh: 8, status: "muy_alto" },
        { name: "Potasio de cambio", value: 5.82, unit: "meq/100g", refLow: 0.5, refHigh: 2.5, status: "muy_alto" },
        { name: "Sodio de cambio", value: 8.64, unit: "meq/100g", refLow: 0, refHigh: 2, status: "muy_alto" },
      ],
    },
  ]);

  const ferts = await db
    .insert(fertilizersTable)
    .values([
      {
        name: "Ácido nítrico 54%",
        formulaType: "liquid",
        nPct: 12.5,
        nNitricPct: 12.5,
        densityKgL: 1.33,
        ecContribution: 1.2,
        incompatibleWith: [],
        notes: "Acidificación del agua de riego: neutraliza la alcalinidad y limpia goteros.",
      },
      {
        name: "Nitrato de calcio",
        formulaType: "solid",
        nPct: 15.5,
        nNitricPct: 14.4,
        nAmmoniacalPct: 1.1,
        caoPct: 26.5,
        ecContribution: 1.2,
        incompatibleWith: ["sulfatos", "fosfatos"],
        notes: "Fuente principal de calcio. No mezclar en tanque con sulfatos ni fosfatos.",
      },
      {
        name: "Sulfato amónico",
        formulaType: "solid",
        nPct: 21,
        nAmmoniacalPct: 21,
        so3Pct: 60,
        ecContribution: 1.9,
        incompatibleWith: ["nitrato de calcio"],
        notes: "Aporta N amoniacal y azufre; efecto acidificante.",
      },
      {
        name: "Sulfato potásico",
        formulaType: "solid",
        k2oPct: 50,
        so3Pct: 45,
        ecContribution: 1.5,
        incompatibleWith: ["nitrato de calcio"],
        notes: "Potasio sin cloruros con aporte de azufre.",
      },
      {
        name: "Kitasal (corrector salino)",
        formulaType: "liquid",
        caoPct: 9,
        densityKgL: 1.3,
        ecContribution: 0.6,
        incompatibleWith: [],
        notes: "Corrector de sodio a base de calcio complejado.",
      },
      {
        name: "Urea 46%",
        formulaType: "solid",
        nPct: 46,
        nUreicPct: 46,
        ecContribution: 0.1,
        incompatibleWith: [],
        notes: "No recomendada en esta finca: pH del suelo muy alcalino.",
      },
      {
        name: "Fosfato monoamónico (MAP)",
        formulaType: "solid",
        nPct: 12,
        nAmmoniacalPct: 12,
        p2o5Pct: 61,
        ecContribution: 0.9,
        incompatibleWith: ["nitrato de calcio"],
        notes: "Fósforo Olsen del suelo muy alto: mantener a 0 salvo indicación.",
      },
      {
        name: "Nitrato amónico 34,5%",
        formulaType: "solid",
        nPct: 34.5,
        nNitricPct: 17.25,
        nAmmoniacalPct: 17.25,
        ecContribution: 1.6,
        incompatibleWith: [],
      },
      {
        name: "Sulfato de magnesio",
        formulaType: "solid",
        mgoPct: 16,
        so3Pct: 32,
        ecContribution: 1.1,
        incompatibleWith: ["nitrato de calcio"],
        notes: "Mg foliar y de suelo ya altos en esta finca: mantener a 0.",
      },
      {
        name: "Quelato de hierro EDDHA 6%",
        formulaType: "solid",
        ecContribution: 0.2,
        incompatibleWith: [],
        notes: "Corrección de Fe en suelos calizos/alcalinos.",
      },
    ])
    .returning();

  const fid = (name: string) => ferts.find((f) => f.name === name)!.id;

  await db.insert(recommendationsTable).values({
    farmId: farm.id,
    title: "Programa semanal pre-parición (octubre 2025)",
    status: "validated",
    source: "manual",
    createdBy: user.id,
    validatedBy: user.id,
    rationale:
      "Deficiencia foliar de calcio (0,88 %) inducida por antagonismo Na/Mg/K y agua alcalina (pH 8,6; alcalinidad 380 mg/L). Se prioriza calcio y azufre, se retira todo aporte de Mg, P y B, y se mantiene la acidificación del agua. Potasio en dosis de mantenimiento con sulfato para aportar S.",
    estimatedEcDsM: 1.25,
    estimatedWeeklyNKg: 13.6,
    warnings: [
      "No mezclar el nitrato de calcio con sulfato amónico ni sulfato potásico en el mismo tanque: aplicar en tanques o días separados.",
      "Mantener la CE de la solución por debajo de 2200 µS/cm.",
      "Valorar aplicación de yeso agrícola en invierno para desplazar el sodio de cambio.",
    ],
    items: [
      {
        fertilizerId: fid("Ácido nítrico 54%"),
        fertilizerName: "Ácido nítrico 54%",
        weeklyDose: 20,
        unit: "L",
        reason: "Neutralizar la alcalinidad del agua (380 mg/L CaCO3) y mantener goteros limpios.",
      },
      {
        fertilizerId: fid("Nitrato de calcio"),
        fertilizerName: "Nitrato de calcio",
        weeklyDose: 42.5,
        unit: "kg",
        reason: "Corregir la deficiencia foliar de Ca (0,88 % frente a 1,0-1,5 %).",
      },
      {
        fertilizerId: fid("Sulfato amónico"),
        fertilizerName: "Sulfato amónico",
        weeklyDose: 30,
        unit: "kg",
        reason: "Aporte de S (foliar 0,17 % bajo) y N amoniacal acidificante.",
      },
      {
        fertilizerId: fid("Sulfato potásico"),
        fertilizerName: "Sulfato potásico",
        weeklyDose: 37.5,
        unit: "kg",
        reason: "Mantenimiento de K en pre-parición con aporte adicional de S.",
      },
      {
        fertilizerId: fid("Kitasal (corrector salino)"),
        fertilizerName: "Kitasal (corrector salino)",
        weeklyDose: 20,
        unit: "L",
        reason: "Desplazar sodio (17 % de la CIC) con calcio complejado.",
      },
    ],
  });

  console.log("Seed completed:", { user: user.email, farm: farm.name });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
