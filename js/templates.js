// Ready-made statistics scenarios. Teachers load one, then edit it freely.

export const TEMPLATES = [
  {
    key: 'sampling',
    name: 'Sampling bias: the huge online poll',
    task: {
      title: 'The 12,000-person Facebook poll',
      brief: 'Tanvir runs an online poll and believes it predicts how the whole country will vote. Find the flaw in his reasoning and convince him he is wrong, using statistical arguments.',
      persona: 'Tanvir, a confident market research analyst at a Dhaka agency',
      opening: "Great news! We polled 12,000 people through a Facebook survey last week. With a sample that big, our margin of error is under 1%, so we can say with real confidence how all adults in Bangladesh will vote. Honestly, I don't see how anyone can argue with numbers this large. Can you?",
      claim: 'An online Facebook poll of 12,000 volunteers accurately represents the voting intentions of all adults in Bangladesh, because the sample is very large and the margin of error is under 1%.',
      defenses: `- The law of large numbers: bigger samples get closer to the truth.
- The margin of error formula (about 1/sqrt(n)) gives less than 1% for n = 12,000.
- Most adults use Facebook now, so the poll covers almost everyone.
- Many professional polls are run online today.
- We balanced the results so men and women are 50/50.`,
      explanation: 'A large sample only reduces random sampling error. It does nothing about bias in how people were selected. Facebook volunteers differ systematically from the population (people without internet access, older and rural adults are under-represented, and people who choose to answer differ from those who do not). The margin of error assumes a random (probability) sample, so it does not apply here: the poll can be precisely wrong.',
      criteria: [
        { text: 'Explains that a larger sample reduces random error but does not remove selection bias: bias is systematic and does not shrink as the sample grows.', required: true, weight: 35 },
        { text: 'Identifies who is missing or under-represented (for example people without internet or Facebook, older, rural or poorer adults), so the sampling frame does not match the population of all adults.', required: true, weight: 30 },
        { text: 'Explains that the margin of error only describes random sampling error and assumes a random (probability) sample, so it is misleading for this poll.', required: true, weight: 20 },
        { text: 'Points out self-selection (voluntary response) bias: the people who choose to answer may differ from those who do not.', required: false, weight: 15 },
      ],
      stubbornness: 'firm',
      language: 'en',
      max_turns: 15,
    },
  },
  {
    key: 'pvalue',
    name: 'Misreading a p-value',
    task: {
      title: 'What p = 0.03 really means',
      brief: 'Dr. Nusrat has just finished a study on a new teaching method and is excited about her p-value. Convince her that she is misinterpreting it.',
      persona: 'Dr. Nusrat, an enthusiastic junior education researcher',
      opening: 'Our experiment worked! Students taught with the new method scored higher, and the t-test gave p = 0.03. That means there is only a 3% chance the null hypothesis is true, so we are 97% sure the new method works. I am writing to the department today to recommend it for every section. Any objections?',
      claim: 'A p-value of 0.03 means there is a 3% probability that the null hypothesis is true, and therefore a 97% probability that the new teaching method works.',
      defenses: `- 0.03 is below 0.05, so the result is statistically significant.
- The p-value is "the probability that the result is due to chance", which is 3%.
- Textbooks say we reject the null hypothesis, so it must be false with high probability.
- 1 − 0.03 = 0.97, so we have 97% confidence.`,
      explanation: 'A p-value is calculated assuming the null hypothesis is true: it is the probability of getting data at least as extreme as observed if there were no real effect, P(data | H0). It is not P(H0 | data). Turning it into the probability that the method works would need prior information (base rates), as in Bayesian reasoning. A significant p-value also says nothing about how large or important the effect is, and a single study can be a false positive.',
      criteria: [
        { text: 'Explains that the p-value is computed assuming the null hypothesis is true: it is the probability of data at least this extreme if there is no effect, not the probability that the null hypothesis is true.', required: true, weight: 40 },
        { text: 'Explains why the probability that the method works cannot be read off a p-value alone (it would need prior information or base rates, for example Bayesian reasoning).', required: true, weight: 30 },
        { text: 'Notes that statistical significance does not show the effect is large or practically important; effect size matters.', required: false, weight: 15 },
        { text: 'Notes that one study with p = 0.03 can still be a false positive (replication, multiple testing, or study design issues).', required: false, weight: 15 },
      ],
      stubbornness: 'firm',
      language: 'en',
      max_turns: 15,
    },
  },
  {
    key: 'causation',
    name: 'Correlation is not causation',
    task: {
      title: 'Free books for better grades?',
      brief: 'Rafiq has found a strong correlation and wants the government to act on it. Convince him that his conclusion does not follow from his data.',
      persona: 'Rafiq, a popular education blogger',
      opening: 'I analysed data on 5,000 secondary students: the more books a family owns, the higher the student scores on exams, with r = 0.62 and p < 0.001. The policy is obvious: give every family 50 books and exam scores across the country will rise. This is one of the strongest findings I have ever seen. Why would anyone oppose it?',
      claim: 'Because the number of books at home is strongly correlated with exam scores (r = 0.62, n = 5,000), giving every family 50 books will raise exam scores.',
      defenses: `- r = 0.62 is a strong correlation.
- n = 5,000 is a very large sample and p < 0.001 is highly significant.
- It makes intuitive sense: reading makes you smarter.
- There is a dose-response pattern: more books, higher scores.`,
      explanation: 'This is observational data, so the correlation does not show that books cause higher scores. A confounder such as family income or parental education can raise both the number of books and exam scores. Reverse causation is also possible (students who do well may ask for more books). A large sample and small p-value show the correlation is reliable, not that it is causal. To test the policy you would need an experiment, for example randomly assigning books to families.',
      criteria: [
        { text: 'Explains that correlation in observational data does not establish that books cause higher scores.', required: true, weight: 30 },
        { text: 'Names a plausible confounder (for example family income or parental education) and explains how it could create the correlation.', required: true, weight: 35 },
        { text: 'Explains that the policy only works if books cause the scores, and suggests how to test this causally (for example a randomised experiment).', required: true, weight: 20 },
        { text: 'Mentions reverse causation, or that a large sample and small p-value show the correlation is reliable, not causal.', required: false, weight: 15 },
      ],
      stubbornness: 'firm',
      language: 'en',
      max_turns: 15,
    },
  },
  {
    key: 'survivorship',
    name: 'Survivorship bias',
    task: {
      title: 'Should you drop out to found a startup?',
      brief: 'Shakil mentors young entrepreneurs and gives advice based on famous founders. Convince him that his evidence does not support his advice.',
      persona: 'Shakil, a startup mentor and motivational speaker',
      opening: 'I studied the 50 most successful tech founders in the world, and 70% of them dropped out of university. The data is clear: dropping out increases your chance of building a successful startup. I tell every ambitious student I meet to seriously consider leaving their degree. Do you think the data says otherwise?',
      claim: 'Because 70% of the 50 most successful tech founders dropped out of university, dropping out increases your chances of startup success.',
      defenses: `- These are real data about real founders.
- Famous examples: many billionaire founders left university.
- The pattern is very consistent across the group.
- Dropouts have more time to focus on their company.`,
      explanation: 'The sample contains only successes, so the many dropouts who failed are invisible (survivorship bias, or selecting on the outcome). To know whether dropping out helps, you must compare success rates between dropouts and graduates; 70% of successes being dropouts says nothing about P(success | dropout). Those who dropped out may also have had other advantages, such as wealth, connections or an already-working product.',
      criteria: [
        { text: 'Explains that the sample only includes successful founders, so dropouts who failed are invisible (survivorship bias or selecting on the outcome).', required: true, weight: 40 },
        { text: 'Explains that you need to compare success rates among dropouts and among graduates (base rates); the 70% figure does not tell you the chance of success after dropping out.', required: true, weight: 35 },
        { text: 'Mentions confounding: those who dropped out may already have had advantages (wealth, connections, an existing product).', required: false, weight: 15 },
        { text: 'Notes that 50 hand-picked famous founders are not a representative sample.', required: false, weight: 10 },
      ],
      stubbornness: 'firm',
      language: 'en',
      max_turns: 15,
    },
  },
  {
    key: 'gambler',
    name: "Probability: the gambler's fallacy",
    task: {
      title: 'Is the captain "due" to win the toss?',
      brief: "Rashed, a cricket commentator, believes Bangladesh's captain is \"due\" to win the next toss after losing five in a row. He even has numbers to back it up. Use what you've learned about probability to convince him that he is wrong.",
      persona: 'Rashed, a passionate cricket commentator on a TV sports talk show',
      opening: "Five tosses in a row, lost! But here's the good news: the law of averages says it has to even out. Think about it: the chance of losing six tosses in a row is only 1 in 64, about 1.6%. So there's a 98% chance our captain wins the next toss. The numbers don't lie, my friend. Do you dare to disagree?",
      claim: 'Because the captain has lost five tosses in a row, he is due to win the next one. The probability of losing six in a row is 1/64, so the probability of winning the next toss is about 98%.',
      defenses: `- The law of averages: things must even out, so a win is due.
- The probability of six losses in a row is (1/2)^6 = 1/64, which is tiny.
- The law of large numbers says the proportion of wins approaches 50%, so wins must come to balance the losses.
- Streaks always end eventually; everyone in cricket knows this.
- Over 100 tosses it will be about 50-50, so the missing wins have to show up soon.`,
      explanation: 'Coin tosses are independent: the coin has no memory, so the probability of winning the next toss is still 1/2. The figure 1/64 is the probability of six losses in a row calculated before any toss is made. Once five losses have already happened, only the sixth toss is uncertain: P(6th loss | 5 losses) = (1/64) / (1/32) = 1/2. The law of large numbers says the long-run proportion approaches 50% because the many future tosses dilute the early streak, not because later tosses compensate for it. A streak of five is also not very rare (1 in 32), and if anything a long streak would hint at a coin biased towards losing, not winning.',
      criteria: [
        { text: "Explains that tosses are independent: the coin has no memory, so earlier results don't change the next toss, and its probability stays 1/2.", required: true, weight: 35 },
        { text: "Explains why 1/64 doesn't apply: it's the probability of six losses calculated before any toss. Given that five losses have already happened, the chance of a sixth is 1/2 (conditional probability).", required: true, weight: 30 },
        { text: 'Explains the law of large numbers correctly: the proportion approaches 50% because future tosses dilute the streak, not because later tosses make up for earlier losses.', required: true, weight: 20 },
        { text: "Notes that five in a row isn't rare (1 in 32), or that a long streak would, if anything, suggest a coin biased towards losing.", required: false, weight: 15 },
      ],
      stubbornness: 'firm',
      language: 'match',
      max_turns: 12,
    },
  },
];

export function blankTask() {
  return {
    title: '',
    brief: '',
    persona: '',
    opening: '',
    claim: '',
    defenses: '',
    explanation: '',
    criteria: [{ text: '', required: true, weight: 50 }, { text: '', required: true, weight: 50 }],
    stubbornness: 'firm',
    language: 'en',
    max_turns: 15,
    is_open: true,
    reveal_criteria: true,
    allow_retry: true,
  };
}
