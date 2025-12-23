const pluralRules = new Intl.PluralRules('en');

export const pluralize = (singular: string, plural: string, count: number): string => {
  const word = pluralRules.select(count) === 'one' ? singular : plural;
  return `${count} ${word}`;
};
