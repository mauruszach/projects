import LiveMarketPage from "@/components/LiveMarketPage";
import { getGraph } from "@/lib/data";

export default function GraphPage() {
  return <LiveMarketPage initialGraph={getGraph()} />;
}
