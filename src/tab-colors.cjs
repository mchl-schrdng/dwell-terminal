const TAB_COLORS = {
  solar: { label: 'Solar', gradient: 'linear-gradient(118deg, #c2a06b, #e0c28c)' },
  ultraviolet: {
    label: 'Ultraviolet',
    gradient: 'linear-gradient(118deg, #8f75c2, #bba1df)',
  },
  lagoon: { label: 'Lagoon', gradient: 'linear-gradient(118deg, #4d79c4, #87a9df)' },
  acid: { label: 'Acid', gradient: 'linear-gradient(118deg, #5c9b90, #8db9a4)' },
  ember: { label: 'Ember', gradient: 'linear-gradient(118deg, #c78f75, #e3b49a)' },
  iris: { label: 'Iris', gradient: 'linear-gradient(118deg, #8493c5, #b2bae0)' },
};
const tabColor = (value) =>
  typeof value === 'string' && Object.hasOwn(TAB_COLORS, value) ? value : null;

module.exports = { TAB_COLORS, tabColor };
