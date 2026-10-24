/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  /** '1' = load URDF meshes as <name>.stl.json (hosts that cannot serve .stl). */
  readonly VITE_MESHES_AS_JSON?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
