"""initial_schema

Revision ID: a3f82c1d0e49
Revises:
Create Date: 2026-05-11 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3f82c1d0e49"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── PostgreSQL ENUM types ──────────────────────────────────────────────────
    protein_source_enum = postgresql.ENUM(
        "PDB", "AlphaFold", name="protein_source_enum", create_type=False
    )
    grid_mode_enum = postgresql.ENUM(
        "blind", "active_site", name="grid_mode_enum", create_type=False
    )
    job_status_enum = postgresql.ENUM(
        "pending", "preparing", "docking", "parsing", "done", "failed",
        name="job_status_enum", create_type=False,
    )

    protein_source_enum.create(op.get_bind(), checkfirst=True)
    grid_mode_enum.create(op.get_bind(), checkfirst=True)
    job_status_enum.create(op.get_bind(), checkfirst=True)

    # ── phytochemicals ────────────────────────────────────────────────────────
    op.create_table(
        "phytochemicals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(512), nullable=False),
        sa.Column("iupac_name", sa.Text, nullable=True),
        sa.Column("market_name", sa.String(512), nullable=True),
        sa.Column("pubchem_cid", sa.Integer, nullable=True),
        sa.Column("smiles", sa.Text, nullable=True),
        sa.Column("inchi", sa.Text, nullable=True),
        sa.Column(
            "inchikey", sa.String(27), nullable=True, unique=True, index=True
        ),
        sa.Column("molecular_weight", sa.Float, nullable=True),
        sa.Column("logp", sa.Float, nullable=True),
        sa.Column("h_bond_donors", sa.Integer, nullable=True),
        sa.Column("h_bond_acceptors", sa.Integer, nullable=True),
        sa.Column("tpsa", sa.Float, nullable=True),
        sa.Column("rotatable_bonds", sa.Integer, nullable=True),
        sa.Column("lipinski_pass", sa.Boolean, nullable=True),
        sa.Column("source_plant", sa.String(512), nullable=True),
        sa.Column("plant_family", sa.String(256), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # ── proteins ──────────────────────────────────────────────────────────────
    op.create_table(
        "proteins",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "protein_code", sa.String(64), nullable=False, unique=True, index=True
        ),
        sa.Column(
            "source",
            postgresql.ENUM(
                "PDB", "AlphaFold", name="protein_source_enum", create_type=False
            ),
            nullable=False,
        ),
        sa.Column("af_model_version", sa.String(16), nullable=True),
        sa.Column("selected_chain", sa.String(4), nullable=True),
        sa.Column("metadata_json", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("pdb_path", sa.Text, nullable=True),
        sa.Column("pdbqt_path", sa.Text, nullable=True),
        sa.Column(
            "grid_mode",
            postgresql.ENUM(
                "blind", "active_site", name="grid_mode_enum", create_type=False
            ),
            nullable=True,
        ),
        sa.Column(
            "grid_params_json", postgresql.JSON(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("cached_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── docking_jobs ──────────────────────────────────────────────────────────
    op.create_table(
        "docking_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "compound_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("phytochemicals.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "protein_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("proteins.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("pathway", sa.Text, nullable=False),
        sa.Column("celery_task_id", sa.String(155), nullable=True, index=True),
        sa.Column(
            "status",
            postgresql.ENUM(
                "pending", "preparing", "docking", "parsing", "done", "failed",
                name="job_status_enum", create_type=False,
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # ── results ───────────────────────────────────────────────────────────────
    op.create_table(
        "results",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("docking_jobs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("compound_name", sa.String(512), nullable=False),
        sa.Column("binding_score", sa.Float, nullable=True),
        sa.Column("rmsd_lower", sa.Float, nullable=True),
        sa.Column("rmsd_upper", sa.Float, nullable=True),
        sa.Column("h_bond_count", sa.Integer, nullable=True),
        sa.Column("pose_file", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("results")
    op.drop_table("docking_jobs")
    op.drop_table("proteins")
    op.drop_table("phytochemicals")

    op.execute("DROP TYPE IF EXISTS job_status_enum")
    op.execute("DROP TYPE IF EXISTS grid_mode_enum")
    op.execute("DROP TYPE IF EXISTS protein_source_enum")
