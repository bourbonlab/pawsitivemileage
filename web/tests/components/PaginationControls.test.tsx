import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaginationControls } from '@/components/PaginationControls';

describe('PaginationControls', () => {
  const defaultProps = {
    currentPage: 1,
    totalPages: 5,
    pageSize: 10,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
  };

  it('displays current page and total pages', () => {
    render(<PaginationControls {...defaultProps} />);
    expect(screen.getByText('Page 1 of 5')).toBeInTheDocument();
  });

  it('disables previous button on first page', () => {
    render(<PaginationControls {...defaultProps} currentPage={1} />);
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
  });

  it('disables next button on last page', () => {
    render(<PaginationControls {...defaultProps} currentPage={5} />);
    expect(screen.getByLabelText('Next page')).toBeDisabled();
  });

  it('enables both buttons on a middle page', () => {
    render(<PaginationControls {...defaultProps} currentPage={3} />);
    expect(screen.getByLabelText('Previous page')).toBeEnabled();
    expect(screen.getByLabelText('Next page')).toBeEnabled();
  });

  it('calls onPageChange with previous page when clicking previous', async () => {
    const onPageChange = vi.fn();
    render(
      <PaginationControls {...defaultProps} currentPage={3} onPageChange={onPageChange} />,
    );

    await userEvent.click(screen.getByLabelText('Previous page'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange with next page when clicking next', async () => {
    const onPageChange = vi.fn();
    render(
      <PaginationControls {...defaultProps} currentPage={3} onPageChange={onPageChange} />,
    );

    await userEvent.click(screen.getByLabelText('Next page'));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('does not render navigation buttons when totalPages is 1', () => {
    render(<PaginationControls {...defaultProps} totalPages={1} />);
    expect(screen.queryByLabelText('Previous page')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument();
  });

  it('shows "Rows per page" label', () => {
    render(<PaginationControls {...defaultProps} />);
    expect(screen.getByText('Rows per page')).toBeInTheDocument();
  });
});
