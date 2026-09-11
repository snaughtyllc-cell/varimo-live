import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TimeSavingsCalculator } from '@/app/landing/TimeSavingsCalculator';
import type { BillingPlan } from '@/lib/types';
const plan = {price_usd:200} as BillingPlan;
afterEach(cleanup);
it('compares equal monthly output and values saved hands-on time', () => {
 render(<TimeSavingsCalculator plan={plan} />);
 expect(screen.getByText('8.3 hours')).toBeInTheDocument();
 expect(screen.getByText('1.7 hours')).toBeInTheDocument();
 expect(screen.getByText('6.7 hours')).toBeInTheDocument();
 expect(screen.getByText('$167/month')).toBeInTheDocument();
 expect(screen.getByText('8 hours saved')).toBeInTheDocument();
});
it('rounds partial packs up and responds to volume and live pricing', () => {
 render(<TimeSavingsCalculator plan={{...plan,price_usd:250}} />);
 fireEvent.change(screen.getByLabelText('Variants needed per month'),{target:{value:'21'}});
 expect(screen.getByText('0.3 hours')).toBeInTheDocument();
 expect(screen.getByText('10 hours saved')).toBeInTheDocument();
});
it('shows unfavorable outcomes instead of manufacturing savings', () => {
 render(<TimeSavingsCalculator plan={plan} />);
 fireEvent.change(screen.getByLabelText('Varimo setup + review minutes per 20-pack'),{target:{value:'200'}});
 expect(screen.getByText('more hands-on time with these inputs')).toBeInTheDocument();
 expect(screen.queryByText(/That time is worth/)).not.toBeInTheDocument();
});
it('handles blank inputs and missing pricing without invalid calculations', () => {
 render(<TimeSavingsCalculator plan={null} />);
 expect(screen.getByText(/Live plan pricing is unavailable/)).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Value of your time per hour (USD)'),{target:{value:''}});
 expect(screen.getByText(/Enter positive values/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Reset example'}));
 expect(screen.getByText('6.7 hours')).toBeInTheDocument();
});
