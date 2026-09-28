# Writer

Plugin de Obsidian para escribir un libro de principio a fin: organiza el
manuscrito, lleva las metas diarias, mantiene el fichero de personajes y mundo,
mide palabras y tiempo, y ofrece un modo de escritura sin distracciones.

Todo se guarda en notas Markdown dentro del vault. No hay base de datos aparte:
el vault es la fuente de verdad, así que puedes editar, versionar o exportar tus
notas con cualquier otra herramienta.

## Instalación

Para usar el plugin tal cual (sin desarrollarlo), lo más fácil es
[BRAT](https://tfthacker.medium.com/introducing-brat-beta-reviewers-auto-update-tool-for-obsidian-63d176db27b5):

1. Instala **BRAT** desde *Ajustes → Plugins de la comunidad*.
2. Ejecuta el comando **BRAT: Add a beta plugin for testing** y pega
   `bguzmanm/obsidian-writer-plugin`.
3. Activa **Writer** en *Ajustes → Plugins de la comunidad*.

BRAT se actualiza solo desde las releases de GitHub (o con el comando
*Check for updates to all beta plugins and UPDATE*), así que no hay que
copiar archivos a mano.

### Instalación manual

```bash
npm install
npm run deploy     # compila y copia manifest.json, main.js y styles.css al vault
```

La ruta del vault se lee de `.deploy-path` (una línea con la ruta completa) o
de la variable de entorno `WRITER_VAULT`. Después recarga Obsidian y activa
**Writer** en *Ajustes → Plugins de la comunidad*.

Para desarrollo, `npm run deploy:watch` recompila en cada cambio dentro de
`src/` y resincroniza los archivos en el vault automáticamente. Si tienes el
plugin de desarrollo **Hot Reload** instalado en tu vault, la actualización de
Writer se aplica sin recargar Obsidian.

## Estructura que crea

Al crear un libro, el plugin genera:

```
Libros/
└── Mi Libro/
    ├── Mi Libro.md            # premisa, tesis, sinopsis, estructura
    ├── Manuscrito/
    │   ├── Manuscrito.md      # índice con el orden de los capítulos
    │   └── 01 - Capítulo 1/
    │       ├── Capítulo 1.md
    │       └── 01 - Escena 1.md
    ├── Personajes/
    ├── Mundo/
    └── Registro/
        └── 2026-09-27.md      # una nota por día de escritura
```

Cada nota lleva un frontmatter `bw_*` que la convierte en escena, personaje,
elemento de mundo o registro diario. El orden de los capítulos vive en el
frontmatter de `Manuscrito.md`, así que reordenar es editar una lista.

## El panel

**Progreso** — palabras de hoy y de la semana frente a la meta, racha de días
seguidos, total del manuscrito frente a la extensión estimada, reparto de escenas
por estado y un mapa de calor de 16 semanas.

**Manuscrito** — capítulos y escenas en orden. Cada escena muestra su recuento, su
POV y su sinopsis. El estado se cambia haciendo clic en la etiqueta.

**Fichero** — personajes agrupados por rol, con las escenas donde aparecen, y
elementos de mundo agrupados por tipo. Si usas un nombre como POV en una escena
sin ficha, aparece marcado en rojo para que puedas crearla.

## Modo escritura

Con **Escribir** (o el comando *Entrar en modo escritura*):

- se ocultan paneles, cinta y barra de estado;
- la línea se limita a un ancho cómodo de lectura;
- el cursor se mantiene centrado verticalmente;
- un HUD muestra el tiempo de la sesión, las palabras del día y cuántas has
  añadido en esta sesión.

**Esc** cierra el modo y guarda la sesión. La sesión mide el tiempo real entre
que la abres y la cierras, y las palabras se obtienen por diferencia del recuento
de la nota, así que reescribir no suma palabras nuevas.

## Comandos

| Comando | Qué hace |
| --- | --- |
| Abrir el panel del libro | Muestra o enfoca el panel lateral |
| Crear un libro nuevo | Carpeta, subcarpetas y notas raíz |
| Manuscrito: nuevo capítulo | Capítulo con su nota y su primera escena |
| Manuscrito: nueva escena | Escena en el capítulo que elijas |
| Manuscrito: abrir una escena | Buscador de escenas |
| Fichero: nuevo personaje | Ficha con la plantilla de personaje |
| Fichero: nuevo elemento de mundo | Ficha de lugar, objeto, facción… |
| Escena: elegir el punto de vista | Asigna el POV desde los personajes existentes |
| Escena: cambiar el estado | Rota idea → esquema → borrador → revisión → terminado |
| Escena: insertar la estructura de sinopsis | Plantilla de conflicto en el cursor |
| Registro: abrir la nota de hoy | Crea la nota del día si no existe |
| Registro: escribir el resumen de hoy | Añade un resumen al final de la nota del día |
| Manuscrito: guardar el recuento en una nota | Volca todas las cifras a `Recuento.md` |
| Empezar / terminar la sesión de escritura | Control manual de la sesión |
| Seguir escribiendo donde lo dejaste | Abre la escena que toca |
| Contar palabras de la nota actual | Recuento de la nota abierta |
| Contar palabras de la selección | Recuento del texto seleccionado |

## Ajustes

- **Carpeta de libros** — dónde se crean los libros (por defecto `Libros`).
- **Meta diaria y semanal** — palabras objetivo.
- **Extensión estimada del libro** — para el porcentaje de avance global.
- **Duración de la sesión** — minutos objetivo del modo escritura.
- **Ocultar la interfaz al escribir** y **cursores centrados**.
- **Contar encabezados** — si activada, los títulos cuentan como palabras.
- **Detectar libro automáticamente** — cambia de libro según la nota abierta.

## Cómo se cuentan las palabras

El recuento ignora la sintaxis de markdown: no cuenta bloques de código, código en
línea, tablas, encabezados (salvo que lo actives) ni la parte visible de los
enlaces. Usa propiedades Unicode, de modo que `corazón`, `Ángela` y
`l'Hôpital` cuentan una palabra cada uno, y los números se pueden excluir. El
frontmatter nunca se cuenta.

## Desarrollo

```bash
npm run dev          # watch + hot reload del plugin (si lo tienes)
npm run deploy       # compila y copia al vault
npm run deploy:watch # esbuild en watch + resincroniza al vault
npm run typecheck    # tsc --noEmit
npm test             # 87 pruebas de conteo, fechas, rachas, esquema y sesiones
npm run build        # typecheck + bundle de producción
scripts/release.sh   # release de GitHub con assets para BRAT
```

Las pruebas cubren el conteo con acentos y puntuación, el salto de años y meses en
el cálculo de fechas, el comportamiento de las rachas con huecos y días sin
escribir, la extracción del cuerpo de una nota con frontmatter y la acumulación de
sesiones a partir de la tabla del registro diario.

## Estructura del código

```
src/
├── main.ts              # orquestación, flujos y eventos del vault
├── types.ts             # tipos del dominio y claves bw_*
├── settings.ts          # ajustes y su pestaña
├── commands/index.ts    # registro de comandos
├── stats/
│   ├── count.ts         # conteo de palabras
│   ├── dates.ts         # fechas y rachas
│   └── sessions.ts      # medición de sesiones
├── ui/
│   ├── sidebar.ts       # panel de tres pestañas
│   ├── focus.ts         # modo escritura
│   ├── modals.ts        # diálogos de entrada
│   └── dom.ts           # helpers de DOM
└── vault/
    ├── schema.ts        # lectura y escritura de frontmatter
    ├── repository.ts    # consultas y estadísticas
    └── structure.ts     # creación de libros, capítulos y escenas
```
