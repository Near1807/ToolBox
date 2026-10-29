// The phrases of the assistant for Courses, taken apart by code.
import { describe, expect, it } from 'vitest';
import { extractAddExtra, extractPlanMeal, extractWhatToEat } from '../backend/commands';

describe('courses: standardised commands', () => {
  it('what to eat', () => {
    expect(extractWhatToEat('qu’est-ce que je mange ce soir')).toEqual({
      day: 'today',
      moment: 'soir',
    });
    expect(extractWhatToEat('qu’est-ce que je mange demain midi')).toEqual({
      day: 'tomorrow',
      moment: 'midi',
    });
    expect(extractWhatToEat('montre ma liste de courses')).toBeNull();
  });
  it('extras and planning', () => {
    expect(extractAddExtra('ajoute café aux extras')).toEqual({ name: 'café' });
    expect(extractAddExtra('ajoute des filtres à la liste de courses')).toEqual({
      name: 'filtres',
    });
    expect(extractAddExtra('ajoute une tâche finir le mix')).toBeNull();
    expect(extractPlanMeal('mets risotto mardi soir')).toEqual({
      meal: 'risotto',
      day: '2',
      moment: 'soir',
    });
    expect(extractPlanMeal('planifie un curry demain midi pour 2 portions')).toEqual({
      meal: 'curry',
      day: 'tomorrow',
      moment: 'midi',
      servings: 2,
    });
    expect(extractPlanMeal('mets risotto')).toBeNull();
  });
});
