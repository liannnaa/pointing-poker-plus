"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

type ConsensusModalProps = {
  onDismiss: () => void;
};

export const CONSENSUS_IMAGES = [
  "/consensus/flower.jpg",
  "/consensus/heart.jpg",
  "/consensus/sunshine.jpg",
  "/consensus/thumbs-up.jpg",
] as const;

export function pickConsensusImage(): string {
  return CONSENSUS_IMAGES[Math.floor(Math.random() * CONSENSUS_IMAGES.length)];
}

export function ConsensusModal({ onDismiss }: ConsensusModalProps) {
  // Chosen once per mount so the image doesn't swap on re-render.
  const [src] = useState(pickConsensusImage);

  useEffect(() => {
    const handler = () => onDismiss();
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [onDismiss]);

  return (
    <div className="consensus-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="consensus-card relative max-w-lg w-full mx-4 rounded-xl overflow-hidden shadow-2xl">
        <Image
          src={src}
          alt="Consensus celebration"
          width={600}
          height={450}
          className="w-full h-[420px] object-contain bg-black"
          priority
        />
        <p className="absolute bottom-0 left-0 right-0 text-center text-sm font-semibold text-white bg-black/50 py-2 tracking-wide uppercase">
          Consensus! 🎉
        </p>
      </div>
    </div>
  );
}
