import "katex/dist/katex.min.css";
import Link from "next/link";
import { D, M } from "@/components/Math";
import { getGraph } from "@/lib/data";

const SECTIONS = [
  ["quick-start", "Start here: a practical walkthrough"],
  ["universe", "1. The universe"],
  ["changes", "2. From prices to log-odds changes"],
  ["screen", "3. The market screen"],
  ["correlation", "4. Pairwise correlation and significance"],
  ["robust", "5. Multiple comparisons and robustness"],
  ["relations", "6. Obvious, related, and non-obvious pairs"],
  ["factor", "7. Is there a market-wide factor?"],
  ["drawing", "8. How the graph is drawn"],
  ["neighborhood", "9. Neighborhood statistics"],
  ["shock", "10. The shock simulator"],
  ["leadlag", "11. Why it is same-day co-movement and not propagation"],
  ["limits", "12. Limits and things to keep in mind"],
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 pt-6 text-lg font-semibold">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="leading-relaxed text-ink-2">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-[var(--grid)] px-1 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>;
}

export default function HowItWorks() {
  const g = getGraph();
  const p = g.params as Record<string, number | string>;
  const sig = g.edges.filter((e) => e.q <= 0.05).length;
  const robust = g.edges.filter((e) => e.robust).length;

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <nav className="hidden lg:block">
        <div className="sticky top-6 space-y-1 text-xs">
          <div className="mb-2 font-semibold text-ink">Contents</div>
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block text-ink-2 hover:text-ink">
              {label}
            </a>
          ))}
        </div>
      </nav>

      <article className="max-w-3xl space-y-4 text-sm">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">How it works</h1>
          <P>
            The <Link href="/" className="underline">market graph</Link> is a map of which live Polymarket
            markets move together from day to day. This page sets out every step that produces it, the
            statistics on the neighborhood cards, and the model behind the shock simulator, with the
            math written out. Where a step was chosen because an earlier version went wrong, that is
            said too.
          </P>
          <P>
            The bundled fallback snapshot (the graph page requests a fresh analysis on each visit): {g.n_screened} markets cleared the metadata screen, {g.nodes.length} have a
            usable daily series, {g.edges.length} edges are drawn, {sig} of them are significant after
            correction and {robust} of those survive the robustness check. Generated {g.generated}.
          </P>
        </header>

        <section id="quick-start" className="card p-4 space-y-3 scroll-mt-20">
          <h2 className="text-lg font-semibold">Start here: a practical walkthrough</h2>
          <P>Suppose you want to explore a market about an interest-rate decision. On the graph page,
            type part of its question to highlight matching dots, then click one. The inspector shows
            its visible neighbors; the simulator and price comparisons appear below the graph.</P>
          <P>First inspect the history. A positive connection means the markets’ daily changes tended
            to move together; a negative one means they tended to move in opposite directions.
            This does not mean their outcomes are identical or that one causes the other. Compare
            the rolling correlation chart to see whether that relationship stayed consistent.</P>
          <P>Next, try a small hypothetical probability change in the simulator and press “Run shock.”
            Read “now” as the price returned during the refresh, falling back to daily history when unavailable and “implied” as a model scenario.
            A change from 40% to 50% is ten percentage points. Other markets are not assumed to move
            by the same amount: their own historical slopes determine their estimated moves.</P>
          <P>Use the variation band to judge how much the daily history leaves unexplained.
            Expanding to two hops includes neighbors of neighbors, but it does not mean a reaction
            takes two days. Every estimate still uses the market’s direct statistical relationship
            with the market you shocked. Re-run after changing settings.</P>
          <P>If the graph is crowded, enable “significant &amp; robust only” or raise the minimum
            correlation. If it is empty, loosen those filters or restore categories. The graph page shows refresh progress and the collection time. Its historical analysis is filtered; a missing connection is not proof of independence.</P>
          <Link href="/" className="underline text-ink-2">Open the graph and try it →</Link>
        </section>

        <H2 id="universe">1. The universe</H2>
        <P>
          Market metadata comes from Polymarket&apos;s Gamma API. Its <Code>/events</Code> endpoint returns
          events sorted by lifetime volume, one hundred per page, each with its tags and its markets. The
          first 1,500 events are pulled. Every market inside them is a candidate if it is active, unresolved,
          has an open order book, and clears a metadata screen: lifetime volume of at least $250,000,
          current liquidity of at least $5,000, and an age of at least 90 days so there is history to
          correlate. Nothing about prices is consulted at this stage.
        </P>
        <P>
          Each market has two CLOB tokens, Yes and No. The Yes token&apos;s daily price history is pulled
          from the CLOB <Code>prices-history</Code> endpoint at daily fidelity over the trailing{" "}
          {String(p.lookback_days)} days. A price is therefore the implied probability that the market&apos;s
          stated outcome happens. Gamma serves no history, only current prices; the CLOB keeps hourly
          history for roughly the trailing month and daily history for a market&apos;s whole life, which is
          why everything here is daily.
        </P>

        <H2 id="changes">2. From prices to log-odds changes</H2>
        <P>
          A probability <M>{"p_t \\in (0,1)"}</M> is mapped to log-odds, clipped away from the boundaries:
        </P>
        <D>{"x_t = \\operatorname{logit}(p_t) = \\ln\\frac{p_t}{1-p_t}, \\qquad p_t \\leftarrow \\min(1-\\varepsilon,\\ \\max(\\varepsilon,\\ p_t)),\\ \\varepsilon = 10^{-4}."}</D>
        <P>
          The object everything else is built on is the daily change <M>{"d_t = x_t - x_{t-1}"}</M>. Log-odds
          rather than raw price differences because a one-point move means very different things at 50%
          and at 95%; the logit puts markets at different probability levels on a comparable scale, and it
          is the scale on which a Gaussian model of changes is least wrong. Days on which a market has no
          observation are left missing, never filled.
        </P>

        <H2 id="screen">3. The market screen</H2>
        <P>
          The first version of this screen kept every market with enough history and produced nonsense at
          the top: a 2027 NBA long shot at 1.8 to 2.0 cents correlating at 0.77 with a market on US military
          strikes. The reason is the tick size. At two cents, one tick is a log-odds change of about 0.1,
          and a market that flickers between 1.8 and 2.0 cents shares that flicker with every other market
          quoted the same way. Of the {g.n_screened} markets that cleared the metadata screen,{" "}
          {g.n_long_shots_excluded} have a median price within 5 cents of 0 or 1.
        </P>
        <P>A market enters the correlation stage only if, over the window, it has:</P>
        <ul className="list-disc space-y-1 pl-6 text-ink-2">
          <li>at least 90 observed days;</li>
          <li>a nonzero change on at least {Math.round(Number(p.min_active_frac) * 100)}% of its observed days (stale quotes are dropped, not zero-filled);</li>
          <li>a median price between {String(p.min_median_price)} and {1 - Number(p.min_median_price)};</li>
          <li>at least {String(p.min_levels)} distinct daily price levels.</li>
        </ul>

        <H2 id="correlation">4. Pairwise correlation and significance</H2>
        <P>
          For every pair of surviving markets <M>{"(a, b)"}</M> with at least {String(p.min_overlap)} days
          on which both are observed, the Spearman rank correlation of their daily changes is computed on
          those common days. Ranks are taken within each market&apos;s observed days, then the Pearson
          correlation of the ranks is evaluated on the pair&apos;s common days. Rank correlation is used
          because daily log-odds changes are heavy-tailed and a single large day can dominate a Pearson
          coefficient.
        </P>
        <D>{"r_{ab} = \\frac{\\sum_{t \\in T_{ab}} (R^a_t - \\bar R^a)(R^b_t - \\bar R^b)}{\\sqrt{\\sum_{t \\in T_{ab}} (R^a_t - \\bar R^a)^2 \\sum_{t \\in T_{ab}} (R^b_t - \\bar R^b)^2}}"}</D>
        <P>
          Each coefficient gets a two-sided p-value from Fisher&apos;s transformation, which is approximately
          standard normal under independence:
        </P>
        <D>{"z_{ab} = \\operatorname{artanh}(r_{ab})\\,\\sqrt{n_{ab} - 3}, \\qquad p_{ab} = 2\\,\\big(1 - \\Phi(|z_{ab}|)\\big)."}</D>

        <H2 id="robust">5. Multiple comparisons and robustness</H2>
        <P>
          With {g.nodes.length} markets there are on the order of{" "}
          {((g.nodes.length * (g.nodes.length - 1)) / 2).toLocaleString()} pairs, and at a 5% threshold
          thousands would be &quot;significant&quot; by chance. The p-values are corrected across every pair
          tested with the Benjamini–Hochberg procedure, which controls the expected share of false
          discoveries among the pairs called significant. With <M>{"P"}</M> pairs and p-values sorted so
          that <M>{"p_{(1)} \\le \\dots \\le p_{(P)}"}</M>,
        </P>
        <D>{"q_{(i)} = \\min_{j \\ge i} \\frac{P\\, p_{(j)}}{j}, \\qquad \\text{significant} \\iff q \\le 0.05."}</D>
        <P>
          A significant pair must then survive a robustness check. Its <M>{`k = ${p.drop_k}`}</M> most
          influential common days are removed, where influence is the magnitude of the day&apos;s
          contribution to the rank covariance, <M>{"|(R^a_t - \\bar R^a)(R^b_t - \\bar R^b)|"}</M>, and the
          correlation and its p-value are recomputed. The pair is kept only if that p-value is still below
          the largest p-value that passed the BH cut. This removes pairs whose whole relationship is one or
          two coincident days.
        </P>

        <H2 id="relations">6. Obvious, related, and non-obvious pairs</H2>
        <P>Every pair is labelled by how much of its correlation is explained by structure you can read off the metadata:</P>
        <ul className="list-disc space-y-1 pl-6 text-ink-2">
          <li>
            <span className="text-ink">same event</span>: both markets belong to one Gamma event. Mutually
            exclusive outcomes are correlated by accounting: their prices sum to about one, so one rising
            forces the others down.
          </li>
          <li>
            <span className="text-ink">shared tag</span>: different events that share at least one specific
            tag. The very generic top-level tags (politics, crypto, sports, business, world, science,
            pop-culture) are ignored for this purpose, so &quot;shared tag&quot; means a real shared
            subject such as <Code>fed-rates</Code> or <Code>iran</Code>.
          </li>
          <li>
            <span className="text-ink">non-obvious</span>: different events with no specific tag in common.
            These are the interesting ones, and there are very few: in the current build the surviving
            cross-tag pairs are the conflict-to-oil-to-rates chain between US–Iran conflict, crude oil, and a
            2026 Fed hike.
          </li>
        </ul>

        <H2 id="factor">7. Is there a market-wide factor?</H2>
        <P>
          If all markets rose and fell together, pairwise correlations would mostly be that shared factor.
          To check, every market&apos;s changes are standardized and an equal-weight index is formed,
        </P>
        <D>{"z_{i,t} = \\frac{d_{i,t} - \\bar d_i}{s_i}, \\qquad f_t = \\frac{1}{N_t}\\sum_{i \\text{ observed at } t} z_{i,t},"}</D>
        <P>
          then each market is regressed on the index and the correlation screen is rerun on the residuals.
          An equal-weight index is used instead of a principal component because with hundreds of markets
          and only a few dozen fully overlapping days the singular-value decomposition is degenerate: an
          early version did that and produced residual correlations of 0.9 between a baseball pennant and
          an acquisition market. The index explains a mean of about 2% of a typical market&apos;s variance.
          Polymarket has essentially no &quot;beta&quot;; correlation lives within clusters.
        </P>

        <H2 id="drawing">8. How the graph is drawn</H2>
        <P>
          Nodes are the {g.nodes.length} markets that passed the screen. A node&apos;s radius scales with the
          square root of lifetime volume, and its color is the event&apos;s top-level category. An edge is
          drawn for every pair that is BH-significant or has <M>{"|r| \\ge 0.15"}</M>, capped at the 8,000
          strongest; non-significant edges are drawn faint so that the threshold slider has range without
          presenting weak pairs as findings.
        </P>
        <P>
          The layout is a force simulation. Each edge is a spring with rest length{" "}
          <M>{"30 + 140\\,(1 - |r|)"}</M> pixels and strength <M>{"0.2 + 0.8\\,|r|"}</M>, so strongly correlated
          markets sit close together; nodes repel with a charge proportional to their size, collide with a
          small margin, and are pulled weakly to the center. Edge width is <M>{"0.5 + 3.5\\,|r|"}</M> pixels and
          opacity rises with <M>{"|r|"}</M>; gray edges are positive correlations and red edges are negative.
          Positions are only a layout; distance on the canvas is suggestive, not a measurement.
        </P>

        <H2 id="neighborhood">9. Neighborhood statistics</H2>
        <P>
          Pinning a node shows one card per connected market. Its Spearman <M>{"r"}</M>, common days{" "}
          <M>{"n"}</M>, and <M>{"q"}</M> are the screen&apos;s corrected values. The rest are descriptive
          summaries computed in the browser from the same daily series:
        </P>
        <ul className="list-disc space-y-2 pl-6 text-ink-2">
          <li>
            <span className="text-ink">rolling correlation</span>: the Pearson correlation of the two
            markets&apos; changes over a trailing 60-day window, shown only where at least 30 of those days are
            jointly observed. It shows whether the relationship is steady or came from one stretch.
          </li>
          <li>
            <span className="text-ink">same-direction days</span>: among days on which both markets moved,
            the share on which they moved the same way.
          </li>
          <li>
            <span className="text-ink">lag ±1</span>: <M>{"\\operatorname{corr}(d_{a,t}, d_{b,t+1})"}</M> and{" "}
            <M>{"\\operatorname{corr}(d_{b,t}, d_{a,t+1})"}</M>, one market&apos;s move today against the
            other&apos;s tomorrow. These are reported because they are the natural question, and they are
            almost always near zero or negative; section 11 explains why they should be read as
            description, not prediction.
          </li>
        </ul>

        <H2 id="shock">10. The shock simulator</H2>
        <P>
          The simulator answers a precise question: if the pinned market <M>{"A"}</M> moved from its latest
          price <M>{"p_A"}</M> to a chosen price <M>{"p_A^*"}</M> today, what would every other market
          within reach historically have done on the same day? The shock is expressed in log-odds,
        </P>
        <D>{"\\Delta = \\operatorname{logit}(p_A^*) - \\operatorname{logit}(p_A)."}</D>
        <P>
          For each market <M>{"i"}</M>, the slope of its daily change on <M>{"A"}</M>&apos;s is estimated by
          ordinary least squares over the days on which at least one of the two moved (days where neither
          moved are stale quotes and would only shrink the estimate):
        </P>
        <D>{"\\beta_{iA} = \\frac{\\operatorname{Cov}(d_i, d_A)}{\\operatorname{Var}(d_A)}, \\qquad \\rho_{iA} = \\frac{\\operatorname{Cov}(d_i, d_A)}{\\sigma_i\\,\\sigma_A}."}</D>
        <P>
          Under a joint-Gaussian view of the two change series, the conditional expectation of{" "}
          <M>{"i"}</M>&apos;s change given <M>{"A"}</M>&apos;s is exactly the linear projection, so the implied
          move and implied price are
        </P>
        <D>{"\\mathbb{E}[d_i \\mid d_A = \\Delta] = \\beta_{iA}\\,\\Delta, \\qquad p_i^{\\text{implied}} = \\sigma\\!\\big(\\operatorname{logit}(p_i) + \\beta_{iA}\\Delta\\big), \\quad \\sigma(x) = \\frac{1}{1+e^{-x}}."}</D>
        <P>
          The band is one residual standard deviation, the spread of what <M>{"i"}</M> actually did on days
          with a given move in <M>{"A"}</M>:
        </P>
        <D>{"s_i^2 = \\frac{1}{n-2}\\sum_t \\big(d_{i,t} - \\beta_{iA} d_{A,t}\\big)^2, \\qquad \\big[\\sigma(x_i + \\beta_{iA}\\Delta - s_i),\\ \\sigma(x_i + \\beta_{iA}\\Delta + s_i)\\big]."}</D>
        <P>
          Two design points matter. First, every market&apos;s move uses only its own pair with{" "}
          <M>{"A"}</M>. A market two hops away in the graph is not moved by pushing the shock through its
          neighbor; it is moved by its own measured relationship with <M>{"A"}</M>, which is usually small.
          Chaining slopes along paths would count the same shared information several times and inflate
          the result, so hop distance, found by breadth-first search over the visible edges, is used only to
          stage the animation and group the table. Second, an empirical check sits beside the model: on the
          10% of days when <M>{"|d_A|"}</M> was largest, the table reports how often <M>{"i"}</M> moved the
          same way. If the slope says +9 points but the market moved the same way on 2 of 8 such days, trust
          the days. Markets with <M>{"|\\rho_{iA}| < 0.1"}</M> are dimmed and not drawn on the canvas.
        </P>

        <H2 id="leadlag">11. Why it is same-day co-movement and not propagation</H2>
        <P>
          The natural hope is that when a thick market jumps, thin markets follow over the next day or two,
          which would make the simulator a forecast. That was tested directly and it fails at daily
          resolution. Pairs were selected on the first 60% of days only, and an event study was run on the
          held-out 40%: for every day on which <M>{"A"}</M> moved more than 2.5 standard deviations, the
          gap between <M>{"B"}</M>&apos;s covariance-implied same-day move and its realized move was
          computed with a slope estimated strictly from prior days, and regressed on <M>{"B"}</M>&apos;s
          cumulative move over the following 1 to 5 days against a circular-shift null.
        </P>
        <D>{"\\text{gap}_t = \\hat\\beta_{BA}^{(<t)}\\, d_{A,t} - d_{B,t}, \\qquad \\text{follow}_{k,t} = \\sum_{u=1}^{k} d_{B,t+u}, \\qquad \\text{slope of follow on gap} \\approx -0.15 \\text{ to } -0.75."}</D>
        <P>
          The slope is negative in every well-populated group of pairs and grows more negative with horizon.
          Markets do not close the implied gap; if anything they give part of the same-day move back. The
          reason is visible in the series themselves: across the screened universe the lag-1 autocorrelation
          of daily changes has a median of about −0.15, and after a market&apos;s own large move the next
          day reverses 55% of the time and continues 30%. That is bid–ask bounce and quote noise in a
          sampled daily price, not information arriving late. So the simulator is honest only as a
          same-day co-movement model, which is what it is labelled.
        </P>

        <H2 id="limits">12. Limits and things to keep in mind</H2>
        <ul className="list-disc space-y-2 pl-6 text-ink-2">
          <li>
            <span className="text-ink">Daily data.</span> Real reaction ordering happens intraday. The CLOB
            keeps only about a month of hourly history, so an hourly archive is being accumulated separately
            and none of it is in this graph yet.
          </li>
          <li>
            <span className="text-ink">Correlation is not mechanism.</span> Two markets can co-move because
            one drives the other, because both respond to the same news, or because the same market makers
            quote both. The graph cannot tell these apart.
          </li>
          <li>
            <span className="text-ink">Same-event edges are accounting.</span> Outcomes of one event sum to
            one; their negative correlations carry no information about the world.
          </li>
          <li>
            <span className="text-ink">The edge set is a search.</span> BH correction controls the false
            discovery rate among the significant edges, but the faint non-significant edges are shown for
            context and should not be read as findings.
          </li>
          <li>
            <span className="text-ink">Stale quotes.</span> Between 25% and 60% of days are unchanged in many
            markets. The screen removes the worst cases and the slope estimator skips days where neither
            market moved, but the effective sample behind every number is smaller than the day count.
          </li>
          <li>
            <span className="text-ink">Not advice.</span> Everything here is a description of past
            co-movement in a thin market with real spreads. It is not a forecast and not a trading signal.
          </li>
        </ul>

      </article>
    </div>
  );
}
