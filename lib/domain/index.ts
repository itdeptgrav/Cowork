/**
 * Cowork domain contracts.
 *
 * These types are the boundary between the UI and whatever provides data. The
 * mock repository satisfies them today; a production API satisfies them later
 * without the UI changing (docs/architecture/MIGRATION_DECISIONS.md §5).
 */

export * from "./identity";
export * from "./tasks";
export * from "./deadlines";
export * from "./availability";
export * from "./breaks";
export * from "./emergency";
export * from "./priority";
export * from "./projects";
export * from "./scoring";
export * from "./work";
export * from "./mrf";
export * from "./documents";
export * from "./mindmap";
export * from "./music";
export * from "./mail";
export * from "./office";
export * from "./monitoring";
export * from "./workflow";
