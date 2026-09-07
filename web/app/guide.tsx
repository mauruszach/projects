const SECTIONS = [
  ["overview", "What this is"],
  ["walkthrough", "Start here: a practical walkthrough"],
  ["data", "Where the data comes from"],
  ["graph", "The graph structure"],
  ["evidence", "Evidence vs. hypothesis"],
  ["agents", "The strategy agents, and the math behind them"],
  ["assistant", "The intelligence assistant"],
  ["byok", "Bring your own key"],
  ["limits", "Limits and things to keep in mind"],
  ["stack", "The tech behind it"],
] as const;

export default function Guide() {
  return (
    <div className="guide">
      <aside className="guide-toc">
        <div className="sidebar-section-title">CONTENTS</div>
        <nav aria-label="Guide sections">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="guide-content">
        <h1>How this site works</h1>
        <p className="guide-lede">
          This is a temporal knowledge graph of global geopolitical events, built from GDELT
          news data, that you can explore, question with an AI assistant, and extend with
          autonomous game-theoretic scenario agents. It is a research and demonstration tool,
          not a forecasting product -- every section below says plainly where a number is real
          data and where it is a model's assumption.
        </p>

        <section id="overview">
          <h2>1. What this is</h2>
          <p>
            The graph you see on the <b>Relationship graph</b> and <b>Event ledger</b> tabs is
            either a small synthetic sandbox (fictional countries, organizations, and people,
            clearly labeled) or a snapshot of real events pulled from this project's own
            ingestion pipeline, which reads the GDELT news-event feed into a Neo4j graph
            database. On top of that graph sit two AI features that both require your own
            Anthropic API key: an assistant you can ask questions, and a set of autonomous
            agents that generate hypothetical "what happens next" branches using real
            game-theoretic reasoning.
          </p>
        </section>

        <section id="walkthrough" className="guide-callout">
          <h2>Start here: a practical walkthrough</h2>
          <p>
            Turn on <b>Feed watcher</b> (in the "Agent activity" tab) to pull the 500 most
            recent real events from the backend, or leave it off to explore the built-in
            synthetic sandbox -- the badge in the top right tells you which one you're looking
            at ("SANDBOX" vs "CONNECTED DATA").
          </p>
          <p>
            Click any entity in the left sidebar, or any node in the graph, to see its
            connections highlighted and its properties in the Inspector on the right. Click a
            real event to read its actual source article.
          </p>
          <p>
            Open the <b>Intelligence assistant</b> tab and enter your own Anthropic key to ask
            questions about whatever is currently loaded -- it can cite specific events by ID
            and can search the live web for current context.
          </p>
          <p>
            Click <b>Run simulation</b> to let Claude reason about one hypothetical next step
            between two actors. Each step is a real API call and takes roughly 30-90 seconds --
            a status banner under the toolbar shows live progress so it is clear something is
            happening, not stuck.
          </p>
        </section>

        <section id="data">
          <h2>2. Where the data comes from</h2>
          <p>
            <b>GDELT</b> (the Global Database of Events, Language, and Tone) scans global news
            coverage and publishes a new batch of coded event records every 15 minutes. Each
            record captures: two actors (who did what to whom), a three-digit <b>CAMEO</b>{" "}
            action code (for example "043" is a consultation, "190" is an act of unconventional
            mass violence), a <b>Goldstein score</b> from -10 to +10 -- a fixed intensity value
            assigned to each CAMEO code, where negative means conflictual and positive means
            cooperative -- an average tone score computed from the source article's language, a
            location, and the source article's URL.
          </p>
          <p>
            This project's ingestion scripts download that feed, parse it, and batch-write it
            into Neo4j. The graph API then serves a bounded slice of it (never the full history
            -- GDELT's volume is enormous) to this interface.
          </p>
        </section>

        <section id="graph">
          <h2>3. The graph structure</h2>
          <p>
            Three node types -- <b>Actor</b> (country, organization, or person), <b>Event</b>,
            and <b>Location</b> -- connected by three relationships:{" "}
            <code>(Actor)-[INITIATED]-&gt;(Event)</code>,{" "}
            <code>(Event)-[TARGETED]-&gt;(Actor)</code>, and{" "}
            <code>(Event)-[OCCURRED_AT]-&gt;(Location)</code>. Time is a plain timestamp on the
            event, not a versioned graph structure, so range queries (an actor's timeline, an
            ego-network around an actor) stay simple.
          </p>
          <p>
            What renders here is a snapshot -- up to 500 of the most recent records fetched
            through the "Feed watcher" -- not a live, continuously streaming view. New data only
            appears when the backend's own ingestion job has run and you refresh the snapshot.
          </p>
        </section>

        <section id="evidence">
          <h2>4. Evidence vs. hypothesis</h2>
          <p>
            This is the one rule the whole interface is built around: solid nodes and links are
            recorded (GDELT) or demo data; dashed links and hollow "SIM" markers are hypothetical
            branches the strategy agents generated. Simulated events are always excluded from the
            descriptive statistics panel and from what the assistant is shown as evidence --
            growing a long hypothetical chain never quietly turns into "what we observed."
          </p>
        </section>

        <section id="agents">
          <h2>5. The strategy agents, and the math behind them</h2>
          <p>Each time you run a simulation step, the following happens, in order:</p>
          <ol>
            <li>One existing event connecting two actors is picked (from whatever is loaded).</li>
            <li>
              That event, plus up to 12 recent related events (including earlier simulated
              steps for the same actors), is sent to Claude, along with your key.
            </li>
            <li>
              Claude states 2-4 plausible next moves available to each actor, then proposes an
              explicit <b>payoff matrix</b>: for every combination of the two actors' possible
              moves, an illustrative number from about -5 to 5 for each actor, estimating how
              favorable that outcome is to them.
            </li>
            <li>
              From that matrix, it works out each actor's <b>best response</b> -- given what the
              other actor is expected to do, which of your own options gives the best payoff --
              and checks whether there is a cell where both actors are simultaneously playing
              their best response to each other. That cell is a <b>Nash equilibrium</b>: neither
              side could do better by unilaterally switching. It is not guaranteed to exist in
              pure strategies, and the agent says so explicitly when it doesn't.
            </li>
            <li>
              Only then does it choose one joint outcome and the app adds it to the graph as a
              new hypothetical event, with the full matrix and reasoning attached -- click any
              simulated node to see them in the Inspector.
            </li>
          </ol>
          <p>
            <b>The payoff numbers are the model's own qualitative judgment, phrased numerically
            for consistency -- they are not derived from data, backtested, or validated against
            real outcomes.</b> Treat a step as "here is one internally consistent, inspectable
            story," not as a quantitative estimate of what will actually happen. Each step takes
            roughly 30-90 seconds because the model is instructed to reason at length before
            answering, and its answer must satisfy a strict schema (the four numbered items
            above are literally required fields in that schema, not just a suggested format).
          </p>
        </section>

        <section id="assistant">
          <h2>6. The intelligence assistant</h2>
          <p>
            Answers questions about whatever evidence sample is currently loaded (demo or real,
            never simulated branches), citing supporting events by ID -- click a citation to jump
            to that event. It can also search the live web for current developments beyond the
            loaded sample, citing source URLs. It is explicitly instructed not to give calibrated
            forecast probabilities or claim a numeric risk score, since no trained forecasting
            model is connected to this interface.
          </p>
        </section>

        <section id="byok">
          <h2>7. Bring your own key</h2>
          <p>
            This site holds no Anthropic API key of its own. Both the assistant and the strategy
            agents send your key with each request directly to Anthropic and never store it
            server-side -- it lives only in this page's memory and is gone on reload. That means
            you pay for what you use, and nobody else's use of this interface spends your budget
            or vice versa.
          </p>
        </section>

        <section id="limits">
          <h2>8. Limits and things to keep in mind</h2>
          <ul>
            <li>
              CAMEO codes, Goldstein scores, and tone are noisy, automated proxies for real-world
              events -- not a verified factual ledger.
            </li>
            <li>
              The real-data view is capped at the 500 most recent records; it is a bounded
              sample, not a complete or continuously live feed.
            </li>
            <li>
              Payoff matrices are the model's own assumption for one hypothetical step, never
              measured or backtested against what actually happened.
            </li>
            <li>
              This project also includes a separate, simple statistical forecasting model
              (graph-derived features plus logistic regression) -- it is not connected to
              anything in this interface; nothing you see here reflects its output.
            </li>
            <li>
              Simulated branches can compound: a later step's "history" can include earlier
              hypothetical steps for the same actors, so a long chain is an increasingly
              speculative narrative, not increasingly confident evidence.
            </li>
          </ul>
        </section>

        <section id="stack">
          <h2>9. The tech behind it</h2>
          <p>
            Next.js for this interface; a Python/FastAPI service backed by Neo4j for the graph
            and its ingestion pipeline; Claude (claude-sonnet-4-6 by default here) for both the
            assistant's web-search-enabled answers and the strategy agents' structured,
            schema-validated payoff-matrix reasoning.
          </p>
        </section>
      </div>
    </div>
  );
}
