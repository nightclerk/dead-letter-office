# Question test bench: runs

The bench ([`eval.html`](../eval.html), live at https://nightclerk.github.io/dead-letter-office/eval.html) runs the clerk's real prompt from `js/clerk.js` over sixteen invented memories, two questions each: one about the memory, and a follow-up after a fixed answer. It counts:

- **usable**: a real question that passed every filter (it is a question, it isn't a repeat, it isn't unkind)
- **first try**: usable without the second, warmer attempt
- **fell back**: nothing usable after two tries, so the office would show a hand-written question instead

Answers are sampled, so every run differs a little. All runs below were on the same laptop, whose GPU has no `shader-f16`, so they use `q4` weights with 32-bit math.

## Gemma 3 1B, 29 October 2026

| Run | Change | Usable | First question | Follow-up | Fell back | Median per question |
|---|---|---|---|---|---|---|
| 1 | as published on 28 October | 21 / 32 | 16 / 16 | 5 / 16 | 11 | 10.1 s |
| 2 | follow-up prompt no longer shows the model its own last question | 26 / 32 | 16 / 16 | 10 / 16 | 6 | 9.4 s |
| 3 | repeat filter ignores filler words and the person's name | 32 / 32 | 16 / 16 | 16 / 16 | 0 | 9.0 s |
| 4 | "taste" left out of the senses; plurals count as the same word | 31 / 32 | 16 / 16 | 15 / 16 | 1 | 9.0 s |

**What run 1 found.** The follow-up prompt read `They remember about Grandpa Avi: <the clerk's last question> <your answer>`. Gemma copied its own last question back 11 times out of 16, the repeat filter rejected every copy, and the visitor silently got a hand-written question. Nothing looked wrong from the outside.

**What run 2 found.** The remaining fallbacks were mostly good questions rejected as repeats, because the filter counted words like "what", "did", "when" and the person's name: *"In what tone did Uncle Dov deliver his jokes?"* looked like *"What did Uncle Dov often say while telling his jokes?"*.

**What run 3 found.** Counting isn't judging. Reading all 32, two were things no grieving person should be asked: *"What did Grandpa Joe taste like when he held the net while fishing?"* (from a side test of the prompt) and *"What did the piano taste like when Grandma June played the hymns?"*. The 1B model attached "taste" to anything. Taste is now out of the prompt, and `unkind()` rejects any question about how a person tasted. Two follow-ups were near-repeats of the first question. One differed only by a plural ("pancakes" / "pancake"), so the filter now treats plurals as the same word. The other was a true paraphrase ("fixing things" / "repairing broken items"), which no word filter will catch.

**Run 4, read by hand.** All 32 questions are below. About half are questions we'd be glad to be asked; most of the rest are clumsy but answerable. The 1B model is fond of colour: six of its questions ask what colour something was, and some of those are trivial ("What color were the tomatoes…?"). None asked how a person tasted.

| # | They wrote | The clerk asked | Secs |
|---|---|---|---|
| 1.1 | Every Friday he peeled oranges in one long spiral and gave me the peel. | Where did Grandpa Avi often peel oranges? | 7.6 |
| 1.2 | At the kitchen table, on top of yesterday's newspaper. | What color was the newspaper on Fridays, according to Grandpa Avi? | 9.0 |
| 2.1 | She hummed while she ironed shirts on Sunday nights. | What did she use to say when she ironed shirts? | 8.0 |
| 2.2 | Old Beatles songs, mostly. She never knew all the words. | What musical genre did she often listen to while ironing shirts? | 9.0 |
| 3.1 | He drove me to swim practice at six in the morning and never once complained. | Where did he usually speak about his driving? | 7.5 |
| 3.2 | He always had a thermos of black coffee between his knees. | What did he use to say about his thermos of coffee? | 8.8 |
| 4.1 | She sent me a postcard from every city she visited. | What color did Aunt Miriam always use to describe the postcards she sent? | 8.6 |
| 4.2 | I kept them all in a shoebox under my bed. | (fell back: both tries repeated 4.1) | 19.9 |
| 5.1 | We built a treehouse together when we were ten. | What did Leo often say about his favorite spot in the woods? | 8.3 |
| 5.2 | It leaked every time it rained and we loved it anyway. | What feeling did you experience when you were building the treehouse? | 9.3 |
| 6.1 | She kept a jar of butterscotch candies on top of the piano. | What color were the candies on top of the piano, according to Grandma June? | 9.0 |
| 6.2 | She played hymns badly and laughed at herself. | Where did Grandma June often store her sweets? | 8.2 |
| 7.1 | He read a poem out loud at the end of every class. | What did Mr. Okafor's voice sound like as he read the poem? | 9.6 |
| 7.2 | His voice got very quiet for the sad ones. | What feeling did Mr. Okafor express while reading the poem? | 9.9 |
| 8.1 | She grew tomatoes on the balcony of a tiny apartment. | What color were the tomatoes Nana grew on the balcony? | 7.7 |
| 8.2 | She talked to them every morning in Italian. | What did the tomatoes taste like when Nana talked to them in Italian? | 9.2 |
| 9.1 | He told terrible jokes at every family dinner. | What kind of laughter did Uncle Dov use to tell awful jokes? | 8.5 |
| 9.2 | The one about the penguin, every single time. | What specific image did Uncle Dov evoke with his penguin joke? | 9.4 |
| 10.1 | She cut my hair in the bathroom when we were kids. | What feeling did Sara associate with the act of cutting her hair? | 8.5 |
| 10.2 | She always made the fringe crooked on purpose. | What did Sara use to say about the fringe on her hair? | 9.0 |
| 11.1 | He fished on the lake every summer morning before anyone else was awake. | What color were the fish they caught while fishing on the lake? | 8.5 |
| 11.2 | He let me hold the net and pretend I caught them. | How did Grandpa Joe's hands feel when he held the net? | 9.2 |
| 12.1 | She left notes in my lunchbox until I was sixteen. | What did Mom's words sound like when she was telling me about her notes? | 9.2 |
| 12.2 | They always ended with a little drawn heart. | Where did the drawings of the hearts appear most frequently in her notes? | 9.4 |
| 13.1 | She sang in the kitchen every Friday while the soup cooked. | Where did Grandma Rachel often hear her voice singing? | 7.8 |
| 13.2 | Always the same old Yiddish song, a little off key. | What was the melody of the Yiddish song that Grandma Rachel always sang while stirring the soup? | 10.7 |
| 14.1 | He made pancakes every Saturday, shaped like the letters of my name. | What did Tom use to say about his pancakes? | 7.9 |
| 14.2 | He always burned the first one and ate it himself. | What did Tom remark about the first pancake he made? | 8.5 |
| 15.1 | She danced in the rain outside the hospital the day she got good news. | What color were the raindrops shimmering as Maya danced in the rain? | 8.7 |
| 15.2 | I was too shy to join her. I wish I had. | What did Maya's laughter sound like when she danced in the rain? | 9.7 |
| 16.1 | He fixed everything in the house with duct tape. | What did Dad use to say when fixing things? | 7.8 |
| 16.2 | Even my glasses once, before a school photo. | What sensation did he describe when working on his repairs? | 17.9 |

## Gemma 4 E2B, 31 October 2026

Same bench, same prompt as run 4 above, `q4` weights.

| Usable | First question | Follow-up | Fell back | Median per question |
|---|---|---|---|---|
| 25 / 32 | 16 / 16 | 9 / 16 | 7 | 34.4 s |

- Seven of sixteen follow-ups were the first question again, word for word, on both tries (the second try runs warmer, and still came back identical).
- It asked about taste even though taste is no longer in the prompt ("What did the lake taste like when Grandpa Joe fished on it?").
- Some text came out garbled, with names and spaces lost: "What did Aunt Miriam'spostcard smell like?", "What sound did Mr.ly use to read the poem?", "What did Grandma with love say?". This looks like a decoding problem in the browser build; we haven't tracked it down.

For this job, on this laptop, the 1B is the better clerk, so it stays the default.

| # | The clerk asked | Secs |
|---|---|---|
| 1.1 | What did the peel sound like when Grandpa Avi peeled the oranges? | 45.4 |
| 1.2 | What did the kitchen table look like on top of the newspaper? | 51.6 |
| 2.1 | What sound did Mom make while ironing the shirts? | 37.4 |
| 2.2 | What song did Mom hum while ironing the shirts? | 29.4 |
| 3.1 | What did Dad say when he drove you to swim practice? | 41.3 |
| 3.2 | (fell back: repeated 3.1 twice) | 94.5 |
| 4.1 | What did Aunt Miriam'spostcard smell like? | 27.0 |
| 4.2 | What did Aunt Miriam'spostcard look like? | 29.5 |
| 5.1 | What did you feel when you built the treehouse with Leo? | 32.7 |
| 5.2 | What did the treehouse sound like when it leaked? | 29.6 |
| 6.1 | What did the jar of candies taste like? | 25.4 |
| 6.2 | What did Grandma with love say? | 26.8 |
| 7.1 | What sound did Mr.ly use to read the poem? | 29.2 |
| 7.2 | What did Mr.use to say at the end of the class? | 68.1 |
| 8.1 | What did Nana grow on the balcony? | 23.6 |
| 8.2 | What did Nana say to the tomatoes every morning? | 34.4 |
| 9.1 | What did Uncle Dov's voice sound like when he told jokes? | 49.0 |
| 9.2 | (fell back: repeated 9.1 twice) | 92.8 |
| 10.1 | What did Sara use to cut your hair? | 27.5 |
| 10.2 | (fell back: repeated 10.1, then a near-repeat) | 59.9 |
| 11.1 | What did the lake taste like when Grandpa Joe fished on it? | 31.7 |
| 11.2 | (fell back: repeated 11.1 twice) | 78.9 |
| 12.1 | What did Mom write on the notes? | 22.1 |
| 12.2 | What did Mom draw on the notes? | 23.4 |
| 13.1 | What sound did their grandmother make while she sang in the kitchen? | 35.8 |
| 13.2 | (fell back: repeated 13.1 twice) | 64.9 |
| 14.1 | What did the pancakes taste like? | 20.4 |
| 14.2 | (fell back: repeated 14.1 twice) | 48.1 |
| 15.1 | What did the rain sound like when Maya danced? | 25.8 |
| 15.2 | (fell back: repeated 15.1 twice) | 75.5 |
| 16.1 | What did Dad use to fix things? | 26.4 |
| 16.2 | What was the texture of the duct tape Dad used? | 75.8 |
