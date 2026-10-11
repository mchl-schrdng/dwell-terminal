const TAB_COLORS = {
  solar: { label: 'Solar', gradient: 'linear-gradient(118deg, #672465, #dc3b3b 47%, #ffad38)' },
  ultraviolet: {
    label: 'Ultraviolet',
    gradient: 'linear-gradient(118deg, #3330a6, #9746e7 52%, #f058b7)',
  },
  lagoon: { label: 'Lagoon', gradient: 'linear-gradient(118deg, #25327b, #227bc8 50%, #4ee0ca)' },
  acid: { label: 'Acid', gradient: 'linear-gradient(118deg, #165354, #68a91e 53%, #e7f566)' },
  ember: { label: 'Ember', gradient: 'linear-gradient(118deg, #682946, #c75b61 50%, #f5ba8c)' },
  iris: { label: 'Iris', gradient: 'linear-gradient(118deg, #4358ba, #aa88d3 52%, #f1bfd5)' },
};
const tabColor = (value) =>
  typeof value === 'string' && Object.hasOwn(TAB_COLORS, value) ? value : null;

module.exports = { TAB_COLORS, tabColor };
