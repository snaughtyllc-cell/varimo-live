import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TimeSavingsCalculator } from '@/app/landing/TimeSavingsCalculator';
import type { BillingPlan } from '@/lib/types';
const plan = {price_usd:200} as BillingPlan;
afterEach(cleanup);
it('separates human work from generation and values manual labor at three rates', () => {
 render(<TimeSavingsCalculator plan={plan} />);
 expect(screen.getByLabelText('Manual minutes per additional output')).toHaveValue(4);
 expect(screen.getByText('1.7 hours')).toBeInTheDocument();
 for(const cost of ['$133','$200','$333']) expect(screen.getByRole('cell',{name:cost,exact:true})).toBeInTheDocument();
 expect(screen.queryByLabelText(/review/)).not.toBeInTheDocument();
 expect(screen.queryByLabelText(/Value of your time/)).not.toBeInTheDocument();
});
it('rounds partial generation packs up and uses live pricing', () => {
 render(<TimeSavingsCalculator plan={{...plan,price_usd:250}} />);
 fireEvent.change(screen.getByLabelText('Variants needed per month'),{target:{value:'21'}});
 expect(screen.getByText('0.3 hours')).toBeInTheDocument();
 expect(screen.getByText('$250/month')).toBeInTheDocument();
});
it('does not subtract background generation from human labor costs', () => {
 render(<TimeSavingsCalculator plan={plan} />);
 fireEvent.change(screen.getByLabelText('Generation minutes per 20-pack'),{target:{value:'200'}});
 expect(screen.getByText('33.3 hours')).toBeInTheDocument();
 expect(screen.getByRole('cell',{name:'$333',exact:true})).toBeInTheDocument();
});
it('handles blank inputs, zero generation time and unavailable pricing', () => {
 render(<TimeSavingsCalculator plan={null} />);
 expect(screen.getByText(/Live plan pricing is unavailable/)).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Generation minutes per 20-pack'),{target:{value:''}});
 expect(screen.getByText(/Enter positive values/)).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Generation minutes per 20-pack'),{target:{value:'0'}});
 expect(screen.getByText(/Enter positive values/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Reset example'}));
 expect(screen.getByText('1.7 hours')).toBeInTheDocument();
});
