import { Embed } from './types';

// Knowledge base for drink-related questions
const drinkKnowledge: Record<string, DrinkInfo> = {
  beer: {
    name: 'Beer',
    description: 'An alcoholic beverage made from fermented grains, primarily barley, flavored with hops.',
    types: ['Lager', 'Ale', 'Stout', 'IPA', 'Pilsner', 'Wheat Beer', 'Porter', 'Sour'],
    servingTemp: '4-7°C (38-45°F) for lagers, 7-13°C (45-55°F) for ales',
    glassware: ['Pint glass', 'Pilsner glass', 'Weizen glass', 'Tulip glass', 'Snifter'],
    funFact: 'Beer is the third most popular drink in the world, after water and tea!',
    pairings: ['Pizza', 'Burgers', 'Fish and chips', 'Cheese', 'BBQ'],
  },
  wine: {
    name: 'Wine',
    description: 'An alcoholic drink made from fermented grapes or other fruits.',
    types: ['Red', 'White', 'Rosé', 'Sparkling', 'Dessert', 'Fortified'],
    servingTemp: '7-18°C depending on type (white cooler, red warmer)',
    glassware: ['Red wine glass', 'White wine glass', 'Champagne flute', 'Port glass'],
    funFact: 'The oldest known winery is over 6,000 years old, found in Armenia!',
    pairings: ['Cheese', 'Steak', 'Seafood', 'Pasta', 'Chocolate'],
  },
  whiskey: {
    name: 'Whiskey/Whisky',
    description: 'A distilled alcoholic beverage made from fermented grain mash, aged in wooden barrels.',
    types: ['Scotch', 'Bourbon', 'Irish', 'Japanese', 'Rye', 'Tennessee'],
    servingTemp: 'Room temperature or slightly chilled, 15-20°C (60-68°F)',
    glassware: ['Glencairn glass', 'Tumbler', 'Rocks glass', 'Snifter'],
    funFact: 'The word "whiskey" comes from the Gaelic "uisce beatha" meaning "water of life"!',
    pairings: ['Dark chocolate', 'Cheese', 'Smoked meats', 'Cigars', 'Nuts'],
  },
  cocktail: {
    name: 'Cocktails',
    description: 'Mixed drinks combining spirits with other ingredients like juices, syrups, and bitters.',
    types: ['Martini', 'Old Fashioned', 'Margarita', 'Mojito', 'Negroni', 'Moscow Mule'],
    servingTemp: 'Varies by cocktail, typically chilled',
    glassware: ['Martini glass', 'Highball', 'Lowball', 'Coupe', 'Collins glass'],
    funFact: 'The first known cocktail recipe book was published in 1862!',
    pairings: ['Appetizers', 'Tapas', 'Light snacks', 'Desserts'],
  },
  coffee: {
    name: 'Coffee',
    description: 'A brewed drink made from roasted coffee beans, containing caffeine.',
    types: ['Espresso', 'Americano', 'Latte', 'Cappuccino', 'Cold Brew', 'Pour Over'],
    servingTemp: '60-70°C (140-158°F) for hot, 1-4°C (34-40°F) for cold',
    glassware: ['Espresso cup', 'Coffee mug', 'Latte glass', 'Mason jar'],
    funFact: 'Coffee is the second most traded commodity in the world after oil!',
    pairings: ['Pastries', 'Chocolate', 'Breakfast foods', 'Desserts'],
  },
  tea: {
    name: 'Tea',
    description: 'An aromatic beverage prepared by pouring hot water over cured tea leaves.',
    types: ['Black', 'Green', 'White', 'Oolong', 'Herbal', 'Chai'],
    servingTemp: '70-100°C depending on type',
    glassware: ['Teacup', 'Tea glass', 'Gaiwan', 'Yunomi'],
    funFact: 'Tea was discovered in China nearly 5,000 years ago by Emperor Shen Nung!',
    pairings: ['Scones', 'Sandwiches', 'Cookies', 'Light desserts'],
  },
};

interface DrinkInfo {
  name: string;
  description: string;
  types: string[];
  servingTemp: string;
  glassware: string[];
  funFact: string;
  pairings: string[];
}

/**
 * Find the most relevant drink category from a question
 */
function findDrinkCategory(question: string): string | null {
  const lowerQuestion = question.toLowerCase();

  const keywords: Record<string, string[]> = {
    beer: ['beer', 'lager', 'ale', 'stout', 'ipa', 'pilsner', 'brew', 'hops', 'malt'],
    wine: ['wine', 'red wine', 'white wine', 'rosé', 'champagne', 'prosecco', 'merlot', 'cabernet', 'chardonnay'],
    whiskey: ['whiskey', 'whisky', 'bourbon', 'scotch', 'rye', 'tennessee', 'single malt'],
    cocktail: ['cocktail', 'martini', 'margarita', 'mojito', 'mixed drink', 'negroni', 'daiquiri'],
    coffee: ['coffee', 'espresso', 'latte', 'cappuccino', 'americano', 'caffeine', 'brew'],
    tea: ['tea', 'green tea', 'black tea', 'oolong', 'chai', 'herbal tea', 'matcha'],
  };

  for (const [category, words] of Object.entries(keywords)) {
    for (const word of words) {
      if (lowerQuestion.includes(word)) {
        return category;
      }
    }
  }

  return null;
}

/**
 * Generate a response based on the question type
 */
function getQuestionType(question: string): string {
  const lowerQuestion = question.toLowerCase();

  if (lowerQuestion.includes('what is') || lowerQuestion.includes('what\'s') || lowerQuestion.includes('define')) {
    return 'definition';
  }
  if (lowerQuestion.includes('type') || lowerQuestion.includes('kind') || lowerQuestion.includes('variety')) {
    return 'types';
  }
  if (lowerQuestion.includes('temperature') || lowerQuestion.includes('serve') || lowerQuestion.includes('cold') || lowerQuestion.includes('warm')) {
    return 'temperature';
  }
  if (lowerQuestion.includes('glass') || lowerQuestion.includes('cup')) {
    return 'glassware';
  }
  if (lowerQuestion.includes('pair') || lowerQuestion.includes('food') || lowerQuestion.includes('eat') || lowerQuestion.includes('match')) {
    return 'pairings';
  }
  if (lowerQuestion.includes('fact') || lowerQuestion.includes('interesting') || lowerQuestion.includes('fun')) {
    return 'funfact';
  }

  return 'general';
}

/**
 * Handle the /drink ask command
 */
export function handleDrinkQuestion(question: string): { content?: string; embeds?: Embed[] } {
  const category = findDrinkCategory(question);

  if (!category) {
    return {
      embeds: [{
        title: '🍹 Drink Question',
        description: 'I couldn\'t identify a specific drink in your question. Try asking about:\n\n• **Beer** - types, serving temperature, pairings\n• **Wine** - varieties, glassware, food pairings\n• **Whiskey** - scotch, bourbon, serving tips\n• **Cocktails** - classic recipes, ingredients\n• **Coffee** - brewing methods, types\n• **Tea** - varieties, preparation',
        color: 0x3498db,
        footer: { text: 'Tip: Be specific! Ask "What types of beer are there?" or "How should I serve whiskey?"' },
      }],
    };
  }

  const drinkInfo = drinkKnowledge[category];
  const questionType = getQuestionType(question);

  let response: { title: string; description: string; fields?: { name: string; value: string; inline?: boolean }[] };

  switch (questionType) {
    case 'definition':
      response = {
        title: `🍹 What is ${drinkInfo.name}?`,
        description: drinkInfo.description,
        fields: [{ name: '💡 Fun Fact', value: drinkInfo.funFact }],
      };
      break;

    case 'types':
      response = {
        title: `🍹 Types of ${drinkInfo.name}`,
        description: drinkInfo.description,
        fields: [{ name: '📋 Popular Types', value: drinkInfo.types.join(', ') }],
      };
      break;

    case 'temperature':
      response = {
        title: `🌡️ Serving Temperature for ${drinkInfo.name}`,
        description: `Best served at: **${drinkInfo.servingTemp}**`,
        fields: [{ name: '🥤 Recommended Glassware', value: drinkInfo.glassware.join(', ') }],
      };
      break;

    case 'glassware':
      response = {
        title: `🥃 Glassware for ${drinkInfo.name}`,
        description: `Recommended glasses for serving ${drinkInfo.name.toLowerCase()}:`,
        fields: [{ name: '🍷 Options', value: drinkInfo.glassware.join('\n• ') }],
      };
      break;

    case 'pairings':
      response = {
        title: `🍽️ Food Pairings for ${drinkInfo.name}`,
        description: `${drinkInfo.name} pairs well with:`,
        fields: [{ name: '🍴 Recommended Pairings', value: drinkInfo.pairings.join(', ') }],
      };
      break;

    case 'funfact':
      response = {
        title: `💡 Fun Fact about ${drinkInfo.name}`,
        description: drinkInfo.funFact,
      };
      break;

    default:
      response = {
        title: `🍹 About ${drinkInfo.name}`,
        description: drinkInfo.description,
        fields: [
          { name: '📋 Types', value: drinkInfo.types.slice(0, 4).join(', '), inline: true },
          { name: '🌡️ Serving Temp', value: drinkInfo.servingTemp.split(',')[0], inline: true },
          { name: '🍽️ Pairs With', value: drinkInfo.pairings.slice(0, 3).join(', '), inline: true },
          { name: '💡 Fun Fact', value: drinkInfo.funFact, inline: false },
        ],
      };
  }

  return {
    embeds: [{
      ...response,
      color: getCategoryColor(category),
      footer: { text: 'Ask me more about drinks! Try: "What temperature should I serve wine?"' },
    }],
  };
}

/**
 * Get a color for each drink category
 */
function getCategoryColor(category: string): number {
  const colors: Record<string, number> = {
    beer: 0xf5a623,    // Amber
    wine: 0x8e44ad,    // Purple
    whiskey: 0xd35400, // Orange/Brown
    cocktail: 0xe74c3c, // Red
    coffee: 0x6d4c41,  // Brown
    tea: 0x27ae60,     // Green
  };
  return colors[category] || 0x3498db;
}

/**
 * Handle the /drink list command
 */
export function handleDrinkList(): { embeds: Embed[] } {
  const categories = Object.values(drinkKnowledge);

  return {
    embeds: [{
      title: '🍹 Drink Categories',
      description: 'I can answer questions about these drink categories:',
      color: 0x3498db,
      fields: categories.map(drink => ({
        name: drink.name,
        value: drink.types.slice(0, 3).join(', ') + '...',
        inline: true,
      })),
      footer: { text: 'Use /drink ask <question> to learn more!' },
    }],
  };
}

/**
 * Handle the /drink random command - returns a random drink fact
 */
export function handleRandomDrinkFact(): { embeds: Embed[] } {
  const categories = Object.keys(drinkKnowledge);
  const randomCategory = categories[Math.floor(Math.random() * categories.length)];
  const drinkInfo = drinkKnowledge[randomCategory];

  return {
    embeds: [{
      title: `💡 Random ${drinkInfo.name} Fact`,
      description: drinkInfo.funFact,
      color: getCategoryColor(randomCategory),
      fields: [
        { name: '📋 Popular Types', value: drinkInfo.types.slice(0, 3).join(', '), inline: true },
        { name: '🍽️ Pairs With', value: drinkInfo.pairings.slice(0, 3).join(', '), inline: true },
      ],
      footer: { text: 'Use /drink random for another fact!' },
    }],
  };
}
