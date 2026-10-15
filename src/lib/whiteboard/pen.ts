export interface PenPointer {
  pointerId: number;
  pointerType: string;
}

export class PenGuard {
  #pens = new Set<number>();
  #palms = new Set<number>();
  seen = false;

  down(e: PenPointer): boolean {
    if (e.pointerType === "pen") {
      this.#pens.add(e.pointerId);
      this.seen = true;
    } else if (e.pointerType === "touch" && this.#pens.size > 0) {
      this.#palms.add(e.pointerId);
    }
    return this.#palms.has(e.pointerId);
  }

  move(e: PenPointer): boolean {
    return this.#palms.has(e.pointerId);
  }

  up(e: PenPointer): boolean {
    this.#pens.delete(e.pointerId);
    return this.#palms.delete(e.pointerId);
  }
}
