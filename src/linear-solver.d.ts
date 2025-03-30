declare class Mat {
    constructor(data: number[][], mirror?: number[][]);
    swap(i: number, j: number): void;
    multline(i: number, l: number): void;
    addmul(i: number, j: number, l: number): void;
    hasNullLine(i: number): boolean;
    gauss(): number[][];
}

export function solve(A: number[][], b: number[]): number[];
export function identity(n: number): number[][];
export function invert(A: number[][]): number[][];