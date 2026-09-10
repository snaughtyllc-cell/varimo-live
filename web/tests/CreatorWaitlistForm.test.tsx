import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CreatorWaitlistForm } from '@/app/landing/CreatorWaitlistForm';
import { joinCreatorWaitlist } from '@/lib/creatorWaitlist';
vi.mock('@/lib/creatorWaitlist', async (original) => ({...await original<typeof import('@/lib/creatorWaitlist')>(), joinCreatorWaitlist: vi.fn()}));
afterEach(() => {cleanup(); vi.clearAllMocks();});
function fill() {
 fireEvent.change(screen.getByLabelText('Email'), {target:{value:'creator@example.com'}});
 fireEvent.change(screen.getByLabelText(/How many variants/), {target:{value:'100_500'}});
 fireEvent.change(screen.getByLabelText(/What monthly budget/), {target:{value:'25_50'}});
 fireEvent.click(screen.getByRole('checkbox'));
}
it('saves demand before displaying confirmation', async () => {
 vi.mocked(joinCreatorWaitlist).mockResolvedValue(undefined);
 const {container}=render(<CreatorWaitlistForm />); fill();
 fireEvent.submit(container.querySelector('form')!);
 expect(await screen.findByRole('status')).toHaveTextContent('You’re on the waitlist');
 expect(joinCreatorWaitlist).toHaveBeenCalledWith(expect.objectContaining({email:'creator@example.com',monthly_budget:'25_50',monthly_variants:'100_500',consent:true}));
});
it('retains input after a failed save and permits retry', async () => {
 vi.mocked(joinCreatorWaitlist).mockRejectedValueOnce(new Error('Could not save')).mockResolvedValueOnce(undefined);
 const {container}=render(<CreatorWaitlistForm />); fill(); fireEvent.submit(container.querySelector('form')!);
 expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
 expect(screen.getByLabelText('Email')).toHaveValue('creator@example.com');
 await waitFor(()=>expect(screen.getByRole('button')).toBeEnabled());
 fireEvent.submit(container.querySelector('form')!);
 expect(await screen.findByRole('status')).toBeInTheDocument();
});
