#!/usr/bin/env python3
"""
Feature Model YAML Parser and Utilities
Demonstrates how to work with the YAML feature models
"""

import yaml
from pathlib import Path
from typing import Dict, List, Any, Optional


class FeatureModelParser:
    """Parser for Feature Model YAML files"""

    def __init__(self, yaml_path: str):
        """Initialize parser with YAML file path"""
        self.yaml_path = Path(yaml_path)
        self.fm = self._load_yaml()

    def _load_yaml(self) -> Dict[str, Any]:
        """Load and parse YAML file"""
        with open(self.yaml_path, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)

    @property
    def namespace(self) -> str:
        """Get feature model namespace"""
        return self.fm.get('namespace', 'Unknown')

    @property
    def features(self) -> Dict[str, Any]:
        """Get root features"""
        return self.fm.get('features', {})

    @property
    def constraints(self) -> List[Dict[str, str]]:
        """Get constraints"""
        return self.fm.get('constraints', [])

    def explore_features(self, features: Optional[Dict] = None, indent: int = 0) -> None:
        """
        Recursively explore and print feature hierarchy

        Args:
            features: Features dictionary (uses root if None)
            indent: Indentation level
        """
        if features is None:
            features = self.features

        for name, props in features.items():
            # Build feature info
            feature_type = props.get('type', 'N/A')
            is_abstract = props.get('abstract', False)
            group_type = props.get('group_type', '')

            # Format output
            prefix = "  " * indent
            abstract_mark = " [A]" if is_abstract else ""
            group_mark = f" <{group_type}>" if group_type else ""

            print(f"{prefix}├─ {name}{abstract_mark} ({feature_type}){group_mark}")

            # Recurse into children
            if 'children' in props:
                self.explore_features(props['children'], indent + 1)

    def get_mandatory_features(self, features: Optional[Dict] = None) -> List[str]:
        """
        Get all mandatory features recursively

        Args:
            features: Features dictionary (uses root if None)

        Returns:
            List of mandatory feature names
        """
        if features is None:
            features = self.features

        mandatory = []

        for name, props in features.items():
            if props.get('type') == 'mandatory':
                mandatory.append(name)

            if 'children' in props:
                child_mandatory = self.get_mandatory_features(props['children'])
                mandatory.extend([f"{name}.{child}" for child in child_mandatory])

        return mandatory

    def get_optional_features(self, features: Optional[Dict] = None) -> List[str]:
        """
        Get all optional features recursively

        Args:
            features: Features dictionary (uses root if None)

        Returns:
            List of optional feature names
        """
        if features is None:
            features = self.features

        optional = []

        for name, props in features.items():
            if props.get('type') == 'optional':
                optional.append(name)

            if 'children' in props:
                child_optional = self.get_optional_features(props['children'])
                optional.extend([f"{name}.{child}" for child in child_optional])

        return optional

    def get_alternative_groups(self, features: Optional[Dict] = None, prefix: str = "") -> Dict[str, List[str]]:
        """
        Get all alternative groups

        Args:
            features: Features dictionary (uses root if None)
            prefix: Prefix for nested features

        Returns:
            Dictionary mapping group names to their options
        """
        if features is None:
            features = self.features

        groups = {}

        for name, props in features.items():
            full_name = f"{prefix}.{name}" if prefix else name

            if props.get('group_type') == 'alternative':
                options = [child for child, child_props in props.get('children', {}).items()
                          if child_props.get('type') == 'alternative_option']
                groups[full_name] = options

            if 'children' in props:
                child_groups = self.get_alternative_groups(props['children'], full_name)
                groups.update(child_groups)

        return groups

    def get_or_groups(self, features: Optional[Dict] = None, prefix: str = "") -> Dict[str, List[str]]:
        """
        Get all OR groups

        Args:
            features: Features dictionary (uses root if None)
            prefix: Prefix for nested features

        Returns:
            Dictionary mapping group names to their options
        """
        if features is None:
            features = self.features

        groups = {}

        for name, props in features.items():
            full_name = f"{prefix}.{name}" if prefix else name

            if props.get('group_type') == 'or':
                options = [child for child, child_props in props.get('children', {}).items()
                          if child_props.get('type') == 'or_option']
                groups[full_name] = options

            if 'children' in props:
                child_groups = self.get_or_groups(props['children'], full_name)
                groups.update(child_groups)

        return groups

    def print_summary(self) -> None:
        """Print feature model summary"""
        print(f"\n{'='*70}")
        print(f"Feature Model: {self.namespace}")
        print(f"File: {self.yaml_path.name}")
        print(f"{'='*70}\n")

        # Feature hierarchy
        print("📊 Feature Hierarchy:")
        print("-" * 70)
        self.explore_features()

        # Mandatory features
        mandatory = self.get_mandatory_features()
        print(f"\n✅ Mandatory Features ({len(mandatory)}):")
        print("-" * 70)
        for feat in mandatory:
            print(f"  • {feat}")

        # Optional features
        optional = self.get_optional_features()
        print(f"\n📦 Optional Features ({len(optional)}):")
        print("-" * 70)
        for feat in optional:
            print(f"  • {feat}")

        # Alternative groups
        alt_groups = self.get_alternative_groups()
        print(f"\n🔀 Alternative Groups ({len(alt_groups)}):")
        print("-" * 70)
        for group, options in alt_groups.items():
            print(f"  • {group}")
            for opt in options:
                print(f"      - {opt}")

        # OR groups
        or_groups = self.get_or_groups()
        print(f"\n🔗 OR Groups ({len(or_groups)}):")
        print("-" * 70)
        for group, options in or_groups.items():
            print(f"  • {group}")
            for opt in options:
                print(f"      - {opt}")

        # Constraints
        if self.constraints:
            print(f"\n⚠️  Constraints ({len(self.constraints)}):")
            print("-" * 70)
            for constraint in self.constraints:
                print(f"  • {constraint.get('expression')}")
                if constraint.get('description'):
                    print(f"    → {constraint.get('description')}")

        print(f"\n{'='*70}\n")


def compare_feature_models(fm1: FeatureModelParser, fm2: FeatureModelParser) -> None:
    """
    Compare two feature models

    Args:
        fm1: First feature model
        fm2: Second feature model
    """
    print(f"\n{'='*70}")
    print(f"Comparing: {fm1.namespace} vs {fm2.namespace}")
    print(f"{'='*70}\n")

    # Compare mandatory features
    mandatory1 = set(fm1.get_mandatory_features())
    mandatory2 = set(fm2.get_mandatory_features())

    print("✅ Mandatory Features:")
    print(f"  {fm1.namespace}: {len(mandatory1)}")
    print(f"  {fm2.namespace}: {len(mandatory2)}")
    print(f"  Common: {len(mandatory1 & mandatory2)}")
    print(f"  Only in {fm1.namespace}: {len(mandatory1 - mandatory2)}")
    print(f"  Only in {fm2.namespace}: {len(mandatory2 - mandatory1)}")

    # Compare optional features
    optional1 = set(fm1.get_optional_features())
    optional2 = set(fm2.get_optional_features())

    print("\n📦 Optional Features:")
    print(f"  {fm1.namespace}: {len(optional1)}")
    print(f"  {fm2.namespace}: {len(optional2)}")
    print(f"  Common: {len(optional1 & optional2)}")
    print(f"  Only in {fm1.namespace}: {len(optional1 - optional2)}")
    print(f"  Only in {fm2.namespace}: {len(optional2 - optional1)}")

    print(f"\n{'='*70}\n")


def main():
    """Main demonstration"""
    print("\n" + "🤖 Feature Model YAML Parser Demo".center(70, "="))

    # Parse all three feature models
    base_path = Path(__file__).parent

    crewai_path = base_path / "crewai" / "crew_agent_FM-Lite.yml"
    adk_path = base_path / "adk" / "adk_agent_FM-Lite.yml"
    generic_path = base_path / "generic_FM_agent.yml"

    # Parse CrewAI
    if crewai_path.exists():
        print("\n📄 Parsing CrewAI Feature Model...")
        crewai_fm = FeatureModelParser(crewai_path)
        crewai_fm.print_summary()

    # Parse ADK
    if adk_path.exists():
        print("\n📄 Parsing ADK Feature Model...")
        adk_fm = FeatureModelParser(adk_path)
        adk_fm.print_summary()

    # Parse Generic
    if generic_path.exists():
        print("\n📄 Parsing Generic Feature Model...")
        generic_fm = FeatureModelParser(generic_path)
        generic_fm.print_summary()

    # Compare feature models
    if crewai_path.exists() and adk_path.exists():
        compare_feature_models(crewai_fm, adk_fm)

    if crewai_path.exists() and generic_path.exists():
        compare_feature_models(crewai_fm, generic_fm)

    if adk_path.exists() and generic_path.exists():
        compare_feature_models(adk_fm, generic_fm)


if __name__ == "__main__":
    main()
