import type { LocalModel } from "../shared/types";

export interface ModelDefinition {
  id: LocalModel;
  label: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  url: string;
}

const revision = "5359861c739e955e79d9a303bcbc70fb988958b1";
const root = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${revision}`;

export const MODEL_CATALOG: Record<LocalModel, ModelDefinition> = {
  "base.en": {
    id: "base.en",
    label: "Base English · faster · 142 MiB",
    filename: "ggml-base.en.bin",
    sizeBytes: 147_964_211,
    sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
    url: `${root}/ggml-base.en.bin`,
  },
  "small.en": {
    id: "small.en",
    label: "Small English · more accurate · 466 MiB",
    filename: "ggml-small.en.bin",
    sizeBytes: 487_614_201,
    sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
    url: `${root}/ggml-small.en.bin`,
  },
};
