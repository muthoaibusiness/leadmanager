import { Card, CardContent, CardHeader, CardTitle } from './card.jsx';
import { ArrowUpRight, ArrowDownRight, Users, CreditCard, TrendingUp, Banknote } from 'lucide-react';

// KPI stat-card grid (adapted from a shadcn/Tailwind component to this project's
// plain-JSX + CSS stack). Data-driven so it can fill the dashboard with real CRM
// metrics; falls back to the original demo cards when no `items` are passed.
const ICONS = { card: CreditCard, users: Users, up: TrendingUp, money: Banknote };

const DEMO = [
  { title: 'Total Revenue', value: '$45,231.89', delta: '+20.1% from last month', icon: 'card' },
  { title: 'Active Users', value: '+2,350', delta: '+18.2% from last month', icon: 'users' },
];

export const Component = ({ items = DEMO }) => {
  return (
    <div className="sc-grid">
      {items.map((it, i) => {
        const Icon = ICONS[it.icon] || CreditCard;
        const down = it.deltaDir === 'down';
        const Delta = down ? ArrowDownRight : ArrowUpRight;
        return (
          <Card key={i}>
            <CardHeader className="sc-row">
              <CardTitle className="sc-kpi-title">{it.title}</CardTitle>
              <Icon className="sc-kpi-ico" />
            </CardHeader>
            <CardContent>
              <div className="sc-kpi-val">{it.value}</div>
              {it.delta && (
                <div className={`sc-kpi-delta${down ? ' down' : ''}`}>
                  <Delta className="sc-kpi-arrow" />
                  <span>{it.delta}</span>
                </div>
              )}
              {!it.delta && it.sub && <div className="sc-kpi-sub">{it.sub}</div>}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default Component;
