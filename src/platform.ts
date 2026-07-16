/** Minimal platform seam; later units may inject filesystem and terminal behavior here. */
export interface Platform {
  readonly cwd: () => string;
}
