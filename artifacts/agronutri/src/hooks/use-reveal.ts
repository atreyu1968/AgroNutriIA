import { useEffect, useRef } from "react";

/**
 * Attaches an IntersectionObserver to the container ref and adds the
 * `is-visible` class to any descendant with the `reveal`, `reveal-left`,
 * `reveal-right` or `reveal-scale` class as it scrolls into view.
 * Staggers children automatically via a small incremental delay.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const targets = Array.from(
      root.querySelectorAll<HTMLElement>(".reveal, .reveal-left, .reveal-right, .reveal-scale")
    );
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            const delay = el.dataset.revealDelay ?? "0";
            el.style.transitionDelay = `${delay}ms`;
            el.classList.add("is-visible");
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );

    targets.forEach((el, i) => {
      if (!el.dataset.revealDelay) {
        el.dataset.revealDelay = String((i % 6) * 90);
      }
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return ref;
}
