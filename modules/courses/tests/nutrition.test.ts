// Nutrition, estimated cost, pieces ↔ weight.
import { describe, expect, it } from 'vitest';
import { costOf, measure, nutritionOf, sumFacts, type IngredientFacts } from '../shared/nutrition';
import { addUp, formatAmount } from '../shared/quantities';

const facts = new Map<string, IngredientFacts>([
  [
    'riz',
    {
      id: 'riz',
      name: 'Riz',
      unit: 'g',
      pieceG: null,
      nutrition: {
        kcal: 350,
        protein: 7,
        carbs: 78,
        sugars: 0.5,
        fat: 0.6,
        saturated: 0.2,
        fiber: 1.5,
        salt: 0,
      },
      nutritionPer: '100g',
      price: 3.2,
      pricePer: 'kg',
    },
  ],
  [
    'oignon',
    {
      id: 'oignon',
      name: 'Oignon',
      unit: 'pièce',
      pieceG: 150,
      nutrition: { kcal: 40, protein: 1.1 },
      nutritionPer: '100g',
      price: 0.3,
      pricePer: 'pièce',
    },
  ],
  [
    'lait',
    {
      id: 'lait',
      name: 'Lait',
      unit: 'l',
      pieceG: null,
      nutrition: {
        kcal: 47,
        protein: 3.3,
        carbs: 4.8,
        sugars: 4.8,
        fat: 1.6,
        saturated: 1,
        fiber: 0,
        salt: 0.1,
      },
      nutritionPer: '100ml',
      price: 1.1,
      pricePer: 'l',
    },
  ],
  [
    'sel',
    {
      id: 'sel',
      name: 'Sel',
      unit: 'pincée',
      pieceG: null,
      nutrition: {},
      nutritionPer: '100g',
      price: null,
      pricePer: null,
    },
  ],
]);

describe('measure', () => {
  it('converts weights, volumes and pieces when it can', () => {
    expect(measure(0.3, 'kg', facts.get('riz')!)).toEqual({ g: 300 });
    expect(measure(25, 'cl', facts.get('lait')!)).toEqual({ ml: 250 });
    expect(measure(2, 'pièce', facts.get('oignon')!)).toEqual({ pieces: 2, g: 300 });
    expect(measure(450, 'g', facts.get('oignon')!)).toEqual({ g: 450, pieces: 3 });
    expect(measure(1, 'c. à s.', facts.get('oignon')!)).toEqual({});
  });
});

describe('nutrition and cost', () => {
  it('adds up the known values and names what is missing', () => {
    const lines = [
      { ingredientId: 'riz', qty: 80, unit: 'g' },
      { ingredientId: 'oignon', qty: 0.5, unit: 'pièce' }, // 75 g
      { ingredientId: 'lait', qty: 20, unit: 'cl' },
      { ingredientId: 'sel', qty: 1, unit: 'pincée' },
    ];
    const n = nutritionOf(lines, facts);
    expect(n.values.kcal).toBe(Math.round((280 + 30 + 94) * 10) / 10);
    expect(n.values.protein).toBe(Math.round((5.6 + 0.825 + 6.6) * 10) / 10);
    // Oignon: only two values given; Sel: none.
    expect(n.missing).toEqual(['Oignon', 'Sel']);
    const c = costOf(lines, facts);
    expect(c.euros).toBe(Math.round((0.256 + 0.15 + 0.22) * 100) / 100);
    expect(c.missing).toEqual(['Sel']);
    expect(sumFacts([n, n]).values.kcal).toBe(808);
  });
  it('a price per piece from a weight needs the piece weight', () => {
    const noWeight = new Map(facts);
    noWeight.set('oignon', { ...facts.get('oignon')!, pieceG: null });
    expect(costOf([{ ingredientId: 'oignon', qty: 300, unit: 'g' }], noWeight).missing).toEqual([
      'Oignon',
    ]);
    expect(costOf([{ ingredientId: 'oignon', qty: 300, unit: 'g' }], facts).euros).toBe(0.6);
  });
});

describe('pieces and weight in the list', () => {
  it('add up with the piece weight, shown in the ingredient unit', () => {
    const lines = [
      { ingredientId: 'oignon', qty: 1, unit: 'pièce' },
      { ingredientId: 'oignon', qty: 225, unit: 'g' },
    ];
    const pieces = new Map([['oignon', { unit: 'pièce', pieceG: 150 }]]);
    expect(addUp(lines, pieces)[0]!.amounts.map(formatAmount)).toEqual(['2,5 pièces (≈ 375 g)']);
    // Without a piece weight they stay apart.
    expect(addUp(lines)[0]!.amounts.map(formatAmount)).toEqual(['1 pièce', '225 g']);
  });
});
