// The JSON file: reading, errors with their line, preview against ToolBox.
import { describe, expect, it } from 'vitest';
import { EXAMPLE, parseExchange, previewImport } from '../shared/exchange';

describe('parseExchange', () => {
  it('reads the example without error', () => {
    const p = parseExchange(JSON.stringify(EXAMPLE, null, 2));
    expect(p.errors).toEqual([]);
    expect(p.ingredients.map((i) => i.name)).toEqual([
      'Riz arborio',
      'Oignon',
      'Bouillon de légumes',
    ]);
    expect(p.recipes[0]!.ingredients).toHaveLength(4);
  });
  it('one error per bad element, with its line', () => {
    const text = `{
  "ingredients": [
    { "name": "Riz", "unit": "g" },
    { "name": "", "unit": "g" },
    { "name": "riz", "unit": "kg" },
    { "name": "Lait", "nutrition": { "kcal": "beaucoup" } },
    { "name": "Thon", "price": { "amount": 12, "per": "boîte" } }
  ],
  "recipes": [
    { "name": "Riz nature", "servings": 0, "ingredients": [] },
    { "name": "Riz au thon", "servings": 2, "ingredients": [{ "name": "Riz", "qty": 150, "unit": "g" }] }
  ]
}`;
    const p = parseExchange(text);
    expect(p.errors.map((e) => `${e.line} ${e.where} : ${e.message}`)).toEqual([
      '4 ingrédient 2 : nom manquant',
      '5 ingrédient 3 « riz » : en double dans le fichier',
      '6 ingrédient 4 « Lait » : « kcal » doit être un nombre ≥ 0',
      '7 ingrédient 5 « Thon » : « price.per » : "kg", "l" ou "pièce"',
      '10 recette 1 « Riz nature » : « servings » : un nombre entier de portions, de 1 à 50',
    ]);
    expect(p.ingredients.map((i) => i.name)).toEqual(['Riz']);
    expect(p.recipes.map((r) => r.name)).toEqual(['Riz au thon']);
  });
  it('unreadable JSON: the line of the problem', () => {
    const p = parseExchange('{\n  "ingredients": [\n    { "name": "Riz" ,, }\n  ]\n}');
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]!.message).toMatch(/JSON illisible/);
  });
});

describe('previewImport', () => {
  it('new, same, to merge; unknown ingredients offered for creation', () => {
    const p = parseExchange(JSON.stringify(EXAMPLE));
    const preview = previewImport(p, {
      ingredients: [
        { ...EXAMPLE.ingredients[0]!, name: 'riz ARBORIO' }, // same values
        { ...EXAMPLE.ingredients[1]!, aisle: 'Légumes', price: null }, // differs
      ],
      recipes: [],
    });
    expect(
      preview.ingredients.map((i) => `${i.name}: ${i.status} ${i.changes.join(', ')}`),
    ).toEqual([
      'riz ARBORIO: same ',
      'Oignon: differs rayon « Légumes » → « Fruits et légumes », prix',
      'Bouillon de légumes: new ',
    ]);
    expect(preview.recipes).toEqual([
      { name: 'Risotto', line: 1, status: 'new', unknown: ['Parmesan'] },
    ]);
    expect(preview.toCreate).toEqual([{ name: 'Parmesan', unit: 'g' }]);
  });
});
